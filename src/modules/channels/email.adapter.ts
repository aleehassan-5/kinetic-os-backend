import nodemailer from "nodemailer";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import type { ChannelAdapter, ChannelCredentials, InboundMessage, OutboundMessage } from "./types";

// Inbound email doesn't hit us directly — a provider (SendGrid Inbound Parse,
// Postmark, Mailgun routes...) receives the raw email and forwards a parsed
// JSON payload to our webhook. This shape covers the common fields; swap the
// field names if you wire a different provider.
interface InboundEmailWebhookBody {
  from?: string;
  fromName?: string;
  subject?: string;
  text?: string;
  html?: string;
  headers?: { secret?: string };
}

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!env.SMTP_HOST) return null;
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transporter;
}

export const emailAdapter: ChannelAdapter = {
  channel: "EMAIL",

  verifySignature(_rawBody, headers) {
    const provided = headers["x-inbound-secret"];
    return provided === env.INBOUND_EMAIL_WEBHOOK_SECRET;
  },

  parseInboundWebhook(body) {
    const payload = body as InboundEmailWebhookBody;
    if (!payload.from || !(payload.text || payload.html)) return [];

    const messages: InboundMessage[] = [
      {
        channel: "EMAIL",
        externalId: payload.from,
        name: payload.fromName,
        text: payload.subject ? `${payload.subject}\n\n${payload.text ?? ""}` : payload.text ?? "",
        timestamp: new Date(),
        raw: payload,
      },
    ];
    return messages;
  },

  // NOTE: email still sends via one shared SMTP account (env.SMTP_*) rather
  // than per-workspace credentials — most teams share one sending domain
  // anyway. Swap this for per-workspace SMTP/API-key creds if that changes.
  async sendMessage(message: OutboundMessage, _credentials?: ChannelCredentials) {
    const t = getTransporter();
    if (!t) {
      logger.warn({ message }, "[email] no SMTP configured — logging outbound message instead of sending");
      return { delivered: false };
    }

    const info = await t.sendMail({
      from: env.SMTP_FROM,
      to: message.externalId,
      subject: "Re: your message to Kinetic OS",
      text: message.text,
    });

    return { delivered: true, providerMessageId: info.messageId };
  },
};
