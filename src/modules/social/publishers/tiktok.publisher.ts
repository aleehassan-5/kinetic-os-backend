import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import type { PublishInput, PublishResult, SocialPublisher } from "../social.types";

export const tiktokPublisher: SocialPublisher = {
  platform: "TIKTOK",

  async publish(input: PublishInput): Promise<PublishResult> {
    if (!env.TIKTOK_ACCESS_TOKEN || !input.mediaUrl) {
      logger.warn({ post: input }, "[tiktok] not configured or no video — logging instead of publishing");
      return { published: false, error: "TikTok not connected — publish skipped" };
    }

    try {
      // TikTok's Content Posting API is a two-step "init then poll" flow
      // (pull the video from a URL, then TikTok processes it async).
      const res = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.TIKTOK_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          post_info: { title: input.caption, privacy_level: "PUBLIC_TO_EVERYONE" },
          source_info: { source: "PULL_FROM_URL", video_url: input.mediaUrl },
        }),
      });
      if (!res.ok) throw new Error(`publish init failed (${res.status}): ${await res.text()}`);
      const data = (await res.json()) as { data?: { publish_id?: string } };
      return { published: true, externalPostId: data.data?.publish_id };
    } catch (err) {
      logger.error({ err: (err as Error).message }, "[tiktok] publish failed");
      return { published: false, error: (err as Error).message };
    }
  },

  async replyToComment(_accountExternalId, commentExternalId, _text): Promise<PublishResult> {
    // TikTok's public API does not expose comment-reply endpoints to third-party apps
    // at time of writing — engagement listening still logs/stores the comment for
    // manual reply from the TikTok app.
    logger.info({ commentExternalId }, "[tiktok] comment reply not supported by the public API — stored for manual reply");
    return { published: false, error: "TikTok comment replies aren't supported via API" };
  },
};
