import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import type { PublishInput, PublishResult, SocialPublisher } from "../social.types";

const GRAPH_VERSION = "v20.0";

export const instagramPublisher: SocialPublisher = {
  platform: "INSTAGRAM",

  async publish(input: PublishInput): Promise<PublishResult> {
    const igBusinessAccountId = input.externalAccountId ?? env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
    if (!env.META_PAGE_ACCESS_TOKEN || !igBusinessAccountId || !input.mediaUrl) {
      logger.warn({ post: input }, "[instagram] not configured or no media — logging instead of publishing");
      return { published: false, error: "Instagram not connected — publish skipped" };
    }

    try {
      // Step 1: create a media container.
      const containerRes = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${igBusinessAccountId}/media`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image_url: input.mediaUrl,
            caption: input.caption,
            access_token: env.META_PAGE_ACCESS_TOKEN,
          }),
        }
      );
      if (!containerRes.ok) throw new Error(`container create failed (${containerRes.status}): ${await containerRes.text()}`);
      const container = (await containerRes.json()) as { id: string };

      // Step 2: publish the container.
      const publishRes = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${igBusinessAccountId}/media_publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ creation_id: container.id, access_token: env.META_PAGE_ACCESS_TOKEN }),
        }
      );
      if (!publishRes.ok) throw new Error(`publish failed (${publishRes.status}): ${await publishRes.text()}`);
      const published = (await publishRes.json()) as { id: string };

      return { published: true, externalPostId: published.id };
    } catch (err) {
      logger.error({ err: (err as Error).message }, "[instagram] publish failed");
      return { published: false, error: (err as Error).message };
    }
  },

  async replyToComment(accountExternalId, commentExternalId, text): Promise<PublishResult> {
    if (!env.META_PAGE_ACCESS_TOKEN) {
      logger.warn({ commentExternalId }, "[instagram] no credentials — logging comment reply instead of sending");
      return { published: false, error: "Instagram not connected — reply skipped" };
    }
    try {
      const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${commentExternalId}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, access_token: env.META_PAGE_ACCESS_TOKEN }),
      });
      if (!res.ok) throw new Error(`comment reply failed (${res.status}): ${await res.text()}`);
      const data = (await res.json()) as { id: string };
      return { published: true, externalPostId: data.id };
    } catch (err) {
      logger.error({ err: (err as Error).message }, "[instagram] comment reply failed");
      return { published: false, error: (err as Error).message };
    }
  },
};
