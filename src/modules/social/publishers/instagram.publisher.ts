import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import type { PublishInput, PublishResult, SocialPublisher } from "../social.types";

const GRAPH_VERSION = "v20.0";

/** Reels container creation is async on Meta's side — poll until it's FINISHED (or ERROR) before publishing. */
async function waitForContainerReady(containerId: string, accessToken: string, maxAttempts = 20): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${containerId}?fields=status_code&access_token=${accessToken}`
    );
    const data = (await res.json()) as { status_code?: string };
    if (data.status_code === "FINISHED") return;
    if (data.status_code === "ERROR") throw new Error("Instagram media container processing failed");
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Instagram media container did not finish processing in time");
}

export const instagramPublisher: SocialPublisher = {
  platform: "INSTAGRAM",

  async publish(input: PublishInput): Promise<PublishResult> {
    const igBusinessAccountId = input.externalAccountId ?? env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
    if (!env.META_PAGE_ACCESS_TOKEN || !igBusinessAccountId || !input.mediaUrl) {
      logger.warn({ post: input }, "[instagram] not configured or no media — logging instead of publishing");
      return { published: false, error: "Instagram not connected — publish skipped" };
    }

    try {
      // Step 1: create a media container — video_url + media_type:REELS for
      // an actual assembled reel video, image_url for a static graphic.
      const containerBody = input.isVideo
        ? { media_type: "REELS", video_url: input.mediaUrl, caption: input.caption, access_token: env.META_PAGE_ACCESS_TOKEN }
        : { image_url: input.mediaUrl, caption: input.caption, access_token: env.META_PAGE_ACCESS_TOKEN };

      const containerRes = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${igBusinessAccountId}/media`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(containerBody),
        }
      );
      if (!containerRes.ok) throw new Error(`container create failed (${containerRes.status}): ${await containerRes.text()}`);
      const container = (await containerRes.json()) as { id: string };

      if (input.isVideo) {
        await waitForContainerReady(container.id, env.META_PAGE_ACCESS_TOKEN);
      }

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
