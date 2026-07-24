import { Router } from "express";
import type { Request, Response } from "express";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { asyncHandler } from "@/middleware/error-handler";
import { channelAdapters } from "@/modules/channels/registry";
import { handleInboundMessage } from "@/modules/leads/leads.service";
import type { Channel } from "@prisma/client";

const router = Router();

/**
 * Every workspace connects a channel independently, so inbound webhooks need
 * to resolve *which* workspace a message belongs to. In production this
 * looks up the Integration row whose stored account id (phone number id,
 * bot token, page id...) matches the incoming payload. For a single-tenant
 * deployment (one workspace per backend instance), it simply resolves the
 * one workspace that has that channel connected.
 */
async function resolveWorkspaceForChannel(channel: Channel): Promise<string | null> {
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

      const workspaceId = await resolveWorkspaceForChannel(channel);
      if (!workspaceId) {
        logger.warn({ channel }, "no workspace has this channel connected — dropping message");
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
registerChannelWebhook("/telegram", "TELEGRAM");
registerChannelWebhook("/instagram", "INSTAGRAM");
registerChannelWebhook("/messenger", "MESSENGER");
registerChannelWebhook("/email", "EMAIL");

export default router;
