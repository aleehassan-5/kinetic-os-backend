import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import type { PublishInput, PublishResult, SocialPublisher } from "../social.types";

const GRAPH_VERSION = "v20.0";

export const facebookPublisher: SocialPublisher = {
  platform: "FACEBOOK",

  async publish(input: PublishInput): Promise<PublishResult> {
    const pageId = input.externalAccountId ?? env.FACEBOOK_PAGE_ID;
    if (!env.META_PAGE_ACCESS_TOKEN || !pageId) {
      logger.warn({ post: input }, "[facebook] not configured — logging instead of publishing");
      return { published: false, error: "Facebook Page not connected — publish skipped" };
    }

    try {
      const endpoint = input.isVideo ? `${pageId}/videos` : input.mediaUrl ? `${pageId}/photos` : `${pageId}/feed`;
      const body: Record<string, string> = { access_token: env.META_PAGE_ACCESS_TOKEN };

      if (input.isVideo && input.mediaUrl) {
        body.file_url = input.mediaUrl;
        if (input.caption) body.description = input.caption;
      } else if (input.mediaUrl) {
        body.url = input.mediaUrl;
        if (input.caption) body.caption = input.caption;
      } else if (input.caption) {
        body.message = input.caption;
      }

      const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`publish failed (${res.status}): ${await res.text()}`);
      const data = (await res.json()) as { id?: string; post_id?: string };
      return { published: true, externalPostId: data.post_id ?? data.id };
    } catch (err) {
      logger.error({ err: (err as Error).message }, "[facebook] publish failed");
      return { published: false, error: (err as Error).message };
    }
  },

  async replyToComment(_accountExternalId, commentExternalId, text): Promise<PublishResult> {
    if (!env.META_PAGE_ACCESS_TOKEN) {
      logger.warn({ commentExternalId }, "[facebook] no credentials — logging comment reply instead of sending");
      return { published: false, error: "Facebook not connected — reply skipped" };
    }
    try {
      const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${commentExternalId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, access_token: env.META_PAGE_ACCESS_TOKEN }),
      });
      if (!res.ok) throw new Error(`comment reply failed (${res.status}): ${await res.text()}`);
      const data = (await res.json()) as { id: string };
      return { published: true, externalPostId: data.id };
    } catch (err) {
      logger.error({ err: (err as Error).message }, "[facebook] comment reply failed");
      return { published: false, error: (err as Error).message };
    }
  },
};
