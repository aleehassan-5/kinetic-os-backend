import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { Integration } from "@prisma/client";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import { encryptJson, decryptJson } from "@/lib/crypto";
import { AppError, NotFoundError } from "@/lib/errors";
import type { Channel, IntegrationType } from "@prisma/client";
import type { ConnectChannelInput } from "./channel-connections.schema";
import type { ChannelCredentials } from "./types";

export interface TestConnectionResult {
  valid: boolean;
  detail: string;
}

/**
 * Actually calls the platform's live API with the credentials the user just
 * typed in, before we ever save or mark anything "Connected". A typo'd
 * token used to silently save as CONNECTED with zero verification — this
 * is the real check behind the "guided setup" claim, not a marketing label.
 */
export async function testConnection(input: ConnectChannelInput): Promise<TestConnectionResult> {
  try {
    switch (input.channel) {
      case "WHATSAPP": {
        const res = await fetch(
          `https://graph.facebook.com/v20.0/${input.phoneNumberId}?fields=display_phone_number,verified_name&access_token=${input.accessToken}`
        );
        if (!res.ok) return { valid: false, detail: await metaErrorDetail(res) };
        const data = (await res.json()) as { display_phone_number?: string; verified_name?: string };
        return {
          valid: true,
          detail: `Verified — ${data.verified_name ?? "WhatsApp Business"} (${data.display_phone_number ?? input.phoneNumberId})`,
        };
      }
      case "INSTAGRAM":
      case "MESSENGER": {
        const res = await fetch(
          `https://graph.facebook.com/v20.0/${input.pageId}?fields=name&access_token=${input.pageAccessToken}`
        );
        if (!res.ok) return { valid: false, detail: await metaErrorDetail(res) };
        const data = (await res.json()) as { name?: string };
        return { valid: true, detail: `Verified — connected to "${data.name ?? input.pageId}"` };
      }
      case "TELEGRAM": {
        const res = await fetch(`https://api.telegram.org/bot${input.botToken}/getMe`);
        const data = (await res.json()) as { ok: boolean; result?: { username?: string }; description?: string };
        if (!data.ok) return { valid: false, detail: data.description ?? "Telegram rejected this bot token" };
        return { valid: true, detail: `Verified — bot @${data.result?.username ?? "unknown"}` };
      }
      case "EMAIL": {
        // No SMTP credentials are collected on this form yet (see Known
        // Gaps) — the only thing to check right now is that it's a
        // plausible address, so we're honest that this isn't a live check.
        return { valid: true, detail: "Address format looks valid (live SMTP delivery isn't tested yet)" };
      }
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message, channel: input.channel }, "[channel-test] connection test failed");
    return { valid: false, detail: "Couldn't reach the platform to verify — check your internet connection and try again" };
  }
}

async function metaErrorDetail(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: { message?: string } };
    return data.error?.message ?? `Meta API rejected this (HTTP ${res.status})`;
  } catch {
    return `Meta API rejected this (HTTP ${res.status})`;
  }
}

function routingKeyFor(input: ConnectChannelInput): string | null {
  switch (input.channel) {
    case "WHATSAPP":
      return input.phoneNumberId;
    case "INSTAGRAM":
    case "MESSENGER":
      return input.pageId;
    default:
      return null; // TELEGRAM is routed via its own per-integration webhook URL; EMAIL via SMTP-only for now
  }
}

function credentialsFor(input: ConnectChannelInput): ChannelCredentials {
  const { channel, ...rest } = input;
  return rest as ChannelCredentials;
}


export async function listConnections(workspaceId: string) {
  const rows = await prisma.integration.findMany({
    where: { workspaceId, type: { in: ["WHATSAPP", "TELEGRAM", "INSTAGRAM", "MESSENGER", "EMAIL"] } },
  });

  const channels: Channel[] = ["WHATSAPP", "TELEGRAM", "INSTAGRAM", "MESSENGER", "EMAIL"];
  return channels.map((channel) => {
    const row = rows.find((r: Integration) => r.type === channel);
    return {
      channel,
      status: row?.status ?? "NOT_CONNECTED",
      detail: row?.detail ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

export async function connectChannel(workspaceId: string, input: ConnectChannelInput) {
  const testResult = await testConnection(input);
  if (!testResult.valid) {
    throw new AppError(`Couldn't verify these credentials: ${testResult.detail}`, 422);
  }

  const credentials = credentialsFor(input);
  const routingKey = routingKeyFor(input);

  const integration = await prisma.integration.upsert({
    where: { workspaceId_type: { workspaceId, type: input.channel as IntegrationType } },
    update: {
      status: "CONNECTED",
      detail: testResult.detail,
      credentials: encryptJson(credentials),
      meta: routingKey ? { routingKey } : {},
    },
    create: {
      workspaceId,
      type: input.channel as IntegrationType,
      status: "CONNECTED",
      detail: testResult.detail,
      credentials: encryptJson(credentials),
      meta: routingKey ? { routingKey } : {},
    },
  });

  if (input.channel === "TELEGRAM") {
    await registerTelegramWebhook(integration.id, input.botToken);
  }

  return { channel: input.channel, status: integration.status, detail: integration.detail };
}

export async function disconnectChannel(workspaceId: string, channel: Channel) {
  const integration = await prisma.integration.findUnique({
    where: { workspaceId_type: { workspaceId, type: channel as IntegrationType } },
  });
  if (!integration) throw new NotFoundError("This channel isn't connected");

  if (channel === "TELEGRAM" && integration.credentials) {
    try {
      const creds = decryptJson<ChannelCredentials>(integration.credentials as unknown as string);
      if (creds.botToken) {
        await fetch(`https://api.telegram.org/bot${creds.botToken}/deleteWebhook`, { method: "POST" });
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "[telegram] failed to remove webhook on disconnect — continuing");
    }
  }

  await prisma.integration.update({
    where: { id: integration.id },
    data: { status: "NOT_CONNECTED", credentials: Prisma.JsonNull, detail: null, meta: {} },
  });

  return { disconnected: true };
}

async function registerTelegramWebhook(integrationId: string, botToken: string) {
  const url = `${env.APP_URL}/webhooks/telegram/${integrationId}`;
  const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      secret_token: env.TELEGRAM_WEBHOOK_SECRET || undefined,
      allowed_updates: ["message"],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new AppError(`Telegram rejected this bot token — double-check it and try again. (${body})`, 422);
  }
}

/** Decrypted credentials for a workspace's connected channel, used when sending a reply. Returns undefined if not connected (adapters then fall back to global env). */
export async function getChannelCredentials(workspaceId: string, channel: Channel): Promise<ChannelCredentials | undefined> {
  const integration = await prisma.integration.findUnique({
    where: { workspaceId_type: { workspaceId, type: channel as IntegrationType } },
  });
  if (!integration || integration.status !== "CONNECTED" || !integration.credentials) return undefined;
  try {
    return decryptJson<ChannelCredentials>(integration.credentials as unknown as string);
  } catch {
    return undefined;
  }
}

/** Resolves which workspace a shared-webhook-URL channel message belongs to, via the provider's own account id embedded in the payload. */
export async function findWorkspaceByRoutingKey(channel: Channel, routingKey: string): Promise<string | null> {
  const integration = await prisma.integration.findFirst({
    where: {
      type: channel as IntegrationType,
      status: "CONNECTED",
      meta: { path: ["routingKey"], equals: routingKey },
    },
  });
  return integration?.workspaceId ?? null;
}

/** For Telegram's per-workspace webhook URL: resolves the integration (and thus workspace) directly by its id. */
export async function findConnectionById(integrationId: string) {
  return prisma.integration.findUnique({ where: { id: integrationId } });
}
