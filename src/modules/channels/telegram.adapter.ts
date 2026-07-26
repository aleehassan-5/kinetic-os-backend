import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import type { ChannelAdapter, ChannelCredentials, InboundMessage, OutboundMessage } from "./types";

interface TelegramUpdate {
  message?: {
    chat: { id: number; first_name?: string; username?: string };
    text?: string;
    date: number;
  };
}

export const telegramAdapter: ChannelAdapter = {
  channel: "TELEGRAM",

  verifySignature(_rawBody, headers) {
    // Telegram authenticates via a secret token you choose when calling setWebhook,
    // echoed back in this header on every request.
    if (!env.TELEGRAM_WEBHOOK_SECRET) return true;
    return headers["x-telegram-bot-api-secret-token"] === env.TELEGRAM_WEBHOOK_SECRET;
  },

  parseInboundWebhook(body) {
    const update = body as TelegramUpdate;
    if (!update.message?.text) return [];

    return [
      {
        channel: "TELEGRAM",
        externalId: String(update.message.chat.id),
        name: update.message.chat.first_name ?? update.message.chat.username,
        text: update.message.text,
        timestamp: new Date(update.message.date * 1000),
        raw: update.message,
      } satisfies InboundMessage,
    ];
  },

  async sendMessage(message: OutboundMessage, credentials?: ChannelCredentials) {
    const botToken = credentials?.botToken || env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      logger.warn({ message }, "[telegram] no bot token configured — logging outbound message instead of sending");
      return { delivered: false };
    }

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: message.externalId, text: message.text }),
    });

    if (!res.ok) {
      logger.error({ status: res.status, body: await res.text() }, "[telegram] send failed");
      return { delivered: false };
    }

    const data = (await res.json()) as { result?: { message_id: number } };
    return { delivered: true, providerMessageId: data.result ? String(data.result.message_id) : undefined };
  },
};
