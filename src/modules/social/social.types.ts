import type { SocialPlatform } from "@prisma/client";

export interface GeneratedAsset {
  mediaUrl: string;
  caption: string;
  script?: string;
}

export interface VoiceoverResult {
  voiceoverUrl: string | null;
  provider: "elevenlabs" | "local-stub";
}

export interface PublishInput {
  externalAccountId: string | null;
  caption: string;
  mediaUrl: string | null;
  voiceoverUrl: string | null;
}

export interface PublishResult {
  published: boolean;
  externalPostId?: string;
  error?: string;
}

export interface InboundComment {
  platform: SocialPlatform;
  accountExternalId: string;
  postExternalId?: string;
  commentExternalId: string;
  authorName?: string;
  text: string;
}

/** One adapter per platform — mirrors the lead-channel adapter pattern in `modules/channels`. */
export interface SocialPublisher {
  platform: SocialPlatform;
  publish(input: PublishInput): Promise<PublishResult>;
  replyToComment(accountExternalId: string, commentExternalId: string, text: string): Promise<PublishResult>;
}
