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

/** Per-workspace credentials a customer enters when connecting a channel (Settings → Channels). Shape varies by channel — see integrations.schema.ts. */
export type ChannelCredentials = Record<string, string | undefined>;

export interface ChannelAdapter {
  channel: Channel;

  /** Used by GET webhook verification handshakes (Meta/WhatsApp/Instagram/Messenger). */
  verifyWebhookChallenge?(query: Record<string, string>): string | null;

  /** Confirms the payload actually came from the provider (HMAC signature etc). */
  verifySignature?(rawBody: string, headers: Record<string, string | string[] | undefined>): boolean;

  /**
   * For channels that share ONE webhook URL across every workspace (WhatsApp,
   * Instagram, Messenger — Meta delivers all of them to your single App-level
   * callback), pulls the provider's own account identifier (phone_number_id,
   * page id...) out of the payload so we can look up which workspace it
   * belongs to. Channels with a per-workspace webhook URL (Telegram) don't need this.
   */
  extractRoutingKey?(body: unknown): string | null;

  /** Turns a provider-specific webhook body into zero or more normalized messages. */
  parseInboundWebhook(body: unknown): InboundMessage[];

  /** Sends a reply back out through the provider's send API, using this workspace's own connected credentials when available (falls back to global env for single-tenant/dev use). */
  sendMessage(message: OutboundMessage, credentials?: ChannelCredentials): Promise<{ delivered: boolean; providerMessageId?: string }>;
}
