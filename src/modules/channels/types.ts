import type { Channel } from "@prisma/client";

/** A message normalized from any channel's raw webhook payload into one shape. */
export interface InboundMessage {
  channel: Channel;
  externalId: string; // the lead's id on that platform (wa number, tg chat id, ig psid, email address...)
  name?: string;
  text: string;
  timestamp: Date;
  raw: unknown;
}

export interface OutboundMessage {
  externalId: string;
  text: string;
}

export interface ChannelAdapter {
  channel: Channel;

  /** Used by GET webhook verification handshakes (Meta/WhatsApp/Instagram/Messenger). */
  verifyWebhookChallenge?(query: Record<string, string>): string | null;

  /** Confirms the payload actually came from the provider (HMAC signature etc). */
  verifySignature?(rawBody: string, headers: Record<string, string | string[] | undefined>): boolean;

  /** Turns a provider-specific webhook body into zero or more normalized messages. */
  parseInboundWebhook(body: unknown): InboundMessage[];

  /** Sends a reply back out through the provider's send API. Stubbed until real keys are added. */
  sendMessage(message: OutboundMessage): Promise<{ delivered: boolean; providerMessageId?: string }>;
}
