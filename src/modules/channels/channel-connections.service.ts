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

function summaryFor(input: ConnectChannelInput): string {
  switch (input.channel) {
    case "WHATSAPP":
      return `Phone number ID ${input.phoneNumberId}`;
    case "TELEGRAM":
      return "Telegram bot connected";
    case "INSTAGRAM":
    case "MESSENGER":
      return `Page ID ${input.pageId}`;
    case "EMAIL":
      return input.fromAddress;
  }
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
  const credentials = credentialsFor(input);
  const routingKey = routingKeyFor(input);

  const integration = await prisma.integration.upsert({
    where: { workspaceId_type: { workspaceId, type: input.channel as IntegrationType } },
    update: {
      status: "CONNECTED",
      detail: summaryFor(input),
      credentials: encryptJson(credentials),
      meta: routingKey ? { routingKey } : {},
    },
    create: {
      workspaceId,
      type: input.channel as IntegrationType,
      status: "CONNECTED",
      detail: summaryFor(input),
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
