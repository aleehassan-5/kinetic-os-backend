import { Router } from "express";
import type { Request, Response } from "express";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { asyncHandler } from "@/middleware/error-handler";
import { env } from "@/config/env";
import { channelAdapters } from "@/modules/channels/registry";
import {
  findWorkspaceByRoutingKey,
  findConnectionById,
} from "@/modules/channels/channel-connections.service";
import { handleInboundMessage } from "@/modules/leads/leads.service";
import { verifyCalendlyWebhookSignature } from "@/lib/calendly";
import type { Channel } from "@prisma/client";

const router = Router();

/**
 * Every workspace connects a channel independently. For channels that share
 * ONE webhook URL across every workspace (WhatsApp/Instagram/Messenger — Meta
 * delivers all of them to your single App-level callback), we resolve the
 * workspace via the routing key (phone_number_id / page id) the adapter pulls
 * out of the payload, matched against each workspace's own connected
 * Integration. If nothing matches (e.g. no one has connected this channel via
 * Settings yet, or you're running a single-tenant setup off pure env vars),
 * we fall back to "whichever workspace connected this channel most recently"
 * so existing single-tenant/dev deployments keep working unchanged.
 */
async function resolveWorkspaceForChannel(channel: Channel, routingKey: string | null): Promise<string | null> {
  if (routingKey) {
    const viaRoutingKey = await findWorkspaceByRoutingKey(channel, routingKey);
    if (viaRoutingKey) return viaRoutingKey;
  }

  const integration = await prisma.integration.findFirst({
    where: { type: channel as never, status: "CONNECTED" },
    orderBy: { updatedAt: "desc" },
  });
  return integration?.workspaceId ?? null;
}

function registerChannelWebhook(path: string, channel: Channel) {
  const adapter = channelAdapters[channel];

  // GET: verification handshake required by Meta (WhatsApp/Instagram/Messenger).
  router.get(
    path,
    asyncHandler(async (req: Request, res: Response) => {
      if (!adapter.verifyWebhookChallenge) return res.status(404).end();
      const challenge = adapter.verifyWebhookChallenge(req.query as Record<string, string>);
      if (challenge === null) return res.status(403).send("Verification failed");
      res.status(200).send(challenge);
    })
  );

  // POST: inbound message delivery.
  router.post(
    path,
    asyncHandler(async (req: Request, res: Response) => {
      const rawBody = (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body);

      if (adapter.verifySignature && !adapter.verifySignature(rawBody, req.headers)) {
        logger.warn({ channel }, "webhook signature verification failed");
        return res.status(401).json({ error: "Invalid signature" });
      }

      const messages = adapter.parseInboundWebhook(req.body);
      if (messages.length === 0) return res.status(200).json({ received: true, processed: 0 });

      const routingKey = adapter.extractRoutingKey?.(req.body) ?? null;
      const workspaceId = await resolveWorkspaceForChannel(channel, routingKey);
      if (!workspaceId) {
        logger.warn({ channel, routingKey }, "no workspace has this channel connected — dropping message");
        return res.status(200).json({ received: true, processed: 0 });
      }

      for (const message of messages) {
        await handleInboundMessage(workspaceId, message);
      }

      res.status(200).json({ received: true, processed: messages.length });
    })
  );
}

registerChannelWebhook("/whatsapp", "WHATSAPP");
registerChannelWebhook("/instagram", "INSTAGRAM");
registerChannelWebhook("/messenger", "MESSENGER");
registerChannelWebhook("/email", "EMAIL");

// Telegram has no matchable account id in its payload, so each workspace's
// bot gets its OWN webhook URL (registered automatically when they connect
// via Settings → Channels) — the :integrationId in the path IS the routing.
router.post(
  "/telegram/:integrationId",
  asyncHandler(async (req: Request, res: Response) => {
    const adapter = channelAdapters.TELEGRAM;
    const secretHeader = req.headers["x-telegram-bot-api-secret-token"];
    if (env.TELEGRAM_WEBHOOK_SECRET && secretHeader !== env.TELEGRAM_WEBHOOK_SECRET) {
      logger.warn("telegram webhook signature verification failed");
      return res.status(401).json({ error: "Invalid signature" });
    }

    const connection = await findConnectionById(req.params.integrationId);
    if (!connection || connection.status !== "CONNECTED") {
      return res.status(200).json({ received: true, processed: 0 });
    }

    const messages = adapter.parseInboundWebhook(req.body);
    for (const message of messages) {
      await handleInboundMessage(connection.workspaceId, message);
    }
    res.status(200).json({ received: true, processed: messages.length });
  })
);

// Legacy single-tenant fallback: one bot configured entirely via
// TELEGRAM_BOT_TOKEN/.env, with no per-workspace connection in Settings.
registerChannelWebhook("/telegram", "TELEGRAM");

interface CalendlyInviteePayload {
  event: "invitee.created" | "invitee.canceled";
  payload: {
    email: string;
    name: string;
    tracking?: { utm_content?: string | null };
    scheduled_event: {
      start_time: string;
      end_time: string;
      name: string;
      location?: { join_url?: string };
    };
    uri: string;
    cancel_url?: string;
  };
}

/**
 * Fires when a lead actually books (or cancels) a time on a link created by
 * calendar_book. This is the only place a Calendly Meeting row gets
 * created — generating the link doesn't create one, since we don't know a
 * real time until the lead picks one. Register this URL (…/webhooks/calendly)
 * as a webhook subscription in Calendly (Integrations → Webhooks, or via
 * their API) for the invitee.created and invitee.canceled events.
 */
router.post(
  "/calendly",
  asyncHandler(async (req: Request, res: Response) => {
    const rawBody = (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body);
    const signature = req.headers["calendly-webhook-signature"] as string | undefined;
    if (!verifyCalendlyWebhookSignature(rawBody, signature)) {
      logger.warn("calendly webhook signature verification failed");
      return res.status(401).json({ error: "Invalid signature" });
    }

    const body = req.body as CalendlyInviteePayload;
    const leadId = body.payload.tracking?.utm_content ?? null;

    // Prefer the leadId we embedded in the scheduling link; fall back to
    // matching by email against any workspace's leads if that's missing
    // (e.g. link was created/shared manually rather than via a workflow).
    const lead = leadId
      ? await prisma.lead.findUnique({ where: { id: leadId } })
      : await prisma.lead.findFirst({ where: { email: body.payload.email }, orderBy: { createdAt: "desc" } });

    if (!lead) {
      logger.warn({ email: body.payload.email }, "calendly webhook: no matching lead found");
      return res.status(200).json({ received: true, matched: false });
    }

    if (body.event === "invitee.created") {
      await prisma.meeting.create({
        data: {
          leadId: lead.id,
          source: "CALENDLY",
          status: "CONFIRMED",
          topic: body.payload.scheduled_event.name,
          startTime: new Date(body.payload.scheduled_event.start_time),
          endTime: new Date(body.payload.scheduled_event.end_time),
          meetingUrl: body.payload.scheduled_event.location?.join_url ?? null,
        },
      });
    } else if (body.event === "invitee.canceled") {
      await prisma.meeting.updateMany({
        where: {
          leadId: lead.id,
          source: "CALENDLY",
          startTime: new Date(body.payload.scheduled_event.start_time),
        },
        data: { status: "CANCELLED" },
      });
    }

    res.status(200).json({ received: true, matched: true });
  })
);

export default router;
