import { createHmac, timingSafeEqual } from "crypto";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import type { ChannelAdapter, ChannelCredentials, InboundMessage, OutboundMessage } from "./types";

// Meta WhatsApp Cloud API payload shape (trimmed to what we consume).
interface WhatsAppWebhookBody {
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
        messages?: Array<{ from: string; timestamp: string; text?: { body?: string }; type: string }>;
      };
    }>;
  }>;
}

export const whatsappAdapter: ChannelAdapter = {
  channel: "WHATSAPP",

  verifyWebhookChallenge(query) {
    if (query["hub.mode"] === "subscribe" && query["hub.verify_token"] === env.WHATSAPP_VERIFY_TOKEN) {
      return query["hub.challenge"] ?? null;
    }
    return null;
  },

  verifySignature(rawBody, headers) {
    if (!env.WHATSAPP_APP_SECRET) return true; // dev mode: signature check skipped without a configured secret
    const signature = headers["x-hub-signature-256"];
    if (typeof signature !== "string") return false;
    const expected = "sha256=" + createHmac("sha256", env.WHATSAPP_APP_SECRET).update(rawBody).digest("hex");
    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  },

  // Every workspace's WhatsApp number rides on the SAME Meta App webhook URL —
  // this is how Meta tells us WHICH workspace a given message belongs to.
  extractRoutingKey(body) {
    const payload = body as WhatsAppWebhookBody;
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const id = change.value?.metadata?.phone_number_id;
        if (id) return id;
      }
    }
    return null;
  },

  parseInboundWebhook(body) {
    const payload = body as WhatsAppWebhookBody;
    const messages: InboundMessage[] = [];

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value?.messages) continue;
        for (const msg of value.messages) {
          if (msg.type !== "text" || !msg.text?.body) continue;
          const contact = value.contacts?.find((c) => c.wa_id === msg.from);
          messages.push({
            channel: "WHATSAPP",
            externalId: msg.from,
            name: contact?.profile?.name,
            text: msg.text.body,
            timestamp: new Date(Number(msg.timestamp) * 1000),
            raw: msg,
          });
        }
      }
    }
    return messages;
  },

  async sendMessage(message: OutboundMessage, credentials?: ChannelCredentials) {
    const accessToken = credentials?.accessToken || env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = credentials?.phoneNumberId || env.WHATSAPP_PHONE_NUMBER_ID;

    if (!accessToken || !phoneNumberId) {
      logger.warn({ message }, "[whatsapp] no credentials configured — logging outbound message instead of sending");
      return { delivered: false };
    }

    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: message.externalId,
        type: "text",
        text: { body: message.text },
      }),
    });

    if (!res.ok) {
      logger.error({ status: res.status, body: await res.text() }, "[whatsapp] send failed");
      return { delivered: false };
    }

    const data = (await res.json()) as { messages?: Array<{ id: string }> };
    return { delivered: true, providerMessageId: data.messages?.[0]?.id };
  },
};
