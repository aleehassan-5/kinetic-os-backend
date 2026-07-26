import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import type { ChannelAdapter, ChannelCredentials, OutboundMessage } from "./types";
import {
  extractMetaRoutingKey,
  parseMetaMessagingWebhook,
  verifyMetaAppSecretSignature,
  verifyMetaWebhookChallenge,
} from "./meta-messaging.shared";

export const instagramAdapter: ChannelAdapter = {
  channel: "INSTAGRAM",
  verifyWebhookChallenge: verifyMetaWebhookChallenge,
  verifySignature: verifyMetaAppSecretSignature,
  extractRoutingKey: extractMetaRoutingKey,
  parseInboundWebhook: (body) => parseMetaMessagingWebhook(body, "INSTAGRAM"),

  async sendMessage(message: OutboundMessage, credentials?: ChannelCredentials) {
    const pageAccessToken = credentials?.pageAccessToken || env.META_PAGE_ACCESS_TOKEN;
    if (!pageAccessToken) {
      logger.warn({ message }, "[instagram] no page access token configured — logging outbound message instead of sending");
      return { delivered: false };
    }

    const res = await fetch(`https://graph.facebook.com/v20.0/me/messages?access_token=${pageAccessToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: message.externalId }, message: { text: message.text } }),
    });

    if (!res.ok) {
      logger.error({ status: res.status, body: await res.text() }, "[instagram] send failed");
      return { delivered: false };
    }

    const data = (await res.json()) as { message_id?: string };
    return { delivered: true, providerMessageId: data.message_id };
  },
};
