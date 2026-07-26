import { createHmac, timingSafeEqual } from "crypto";
import type { Channel } from "@prisma/client";
import { env } from "@/config/env";
import type { InboundMessage } from "./types";

// Both Instagram DMs and Messenger ride on the same Meta "Messenger Platform"
// webhook shape: entry[].messaging[] with sender.id + message.text. entry[].id
// is the page/IG business account id — every workspace's page rides on the
// same App-level webhook URL, so this is how we know whose message it is.
interface MetaMessagingWebhookBody {
  entry?: Array<{
    id?: string;
    messaging?: Array<{
      sender: { id: string };
      timestamp: number;
      message?: { text?: string; is_echo?: boolean };
    }>;
  }>;
}

export function extractMetaRoutingKey(body: unknown): string | null {
  const payload = body as MetaMessagingWebhookBody;
  return payload.entry?.[0]?.id ?? null;
}

export function parseMetaMessagingWebhook(body: unknown, channel: Channel): InboundMessage[] {
  const payload = body as MetaMessagingWebhookBody;
  const messages: InboundMessage[] = [];

  for (const entry of payload.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      if (!event.message?.text || event.message.is_echo) continue; // skip echoes of our own outbound sends
      messages.push({
        channel,
        externalId: event.sender.id,
        text: event.message.text,
        timestamp: new Date(event.timestamp),
        raw: event,
      });
    }
  }
  return messages;
}

export function verifyMetaAppSecretSignature(rawBody: string, headers: Record<string, string | string[] | undefined>): boolean {
  if (!env.META_APP_SECRET) return true;
  const signature = headers["x-hub-signature-256"];
  if (typeof signature !== "string") return false;
  const expected = "sha256=" + createHmac("sha256", env.META_APP_SECRET).update(rawBody).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function verifyMetaWebhookChallenge(query: Record<string, string>): string | null {
  if (query["hub.mode"] === "subscribe" && query["hub.verify_token"] === env.META_VERIFY_TOKEN) {
    return query["hub.challenge"] ?? null;
  }
  return null;
}
