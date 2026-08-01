import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import type { PublishInput, PublishResult, SocialPublisher } from "../social.types";

export const linkedinPublisher: SocialPublisher = {
  platform: "LINKEDIN",

  async publish(input: PublishInput): Promise<PublishResult> {
    const accessToken = input.credentials?.accessToken || env.LINKEDIN_ACCESS_TOKEN;
    const authorUrn = input.externalAccountId || input.credentials?.organizationUrn || env.LINKEDIN_ORGANIZATION_URN;
    if (!accessToken || !authorUrn) {
      logger.warn({ post: input }, "[linkedin] not configured — logging instead of publishing");
      return { published: false, error: "LinkedIn not connected — connect it in Settings → Social Accounts" };
    }

    // LinkedIn video needs a real registerUpload → PUT binary → reference-asset
    // flow, not just a URL — unlike Instagram/Facebook/TikTok, LinkedIn's API
    // won't pull video from a URL for you. That's not implemented yet, so we
    // decline clearly instead of sending a request that would just fail with
    // a confusing API error.
    if (input.isVideo) {
      logger.warn({ post: input }, "[linkedin] video (reel) publishing not implemented — needs LinkedIn's asset upload flow");
      return { published: false, error: "LinkedIn video publishing isn't built yet — only image/text posts are supported" };
    }

    try {
      const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify({
          author: authorUrn,
          lifecycleState: "PUBLISHED",
          specificContent: {
            "com.linkedin.ugc.ShareContent": {
              shareCommentary: { text: input.caption },
              shareMediaCategory: input.mediaUrl ? "IMAGE" : "NONE",
              ...(input.mediaUrl ? { media: [{ status: "READY", originalUrl: input.mediaUrl }] } : {}),
            },
          },
          visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
        }),
      });
      if (!res.ok) throw new Error(`publish failed (${res.status}): ${await res.text()}`);
      const externalPostId = res.headers.get("x-restli-id") ?? undefined;
      return { published: true, externalPostId };
    } catch (err) {
      logger.error({ err: (err as Error).message }, "[linkedin] publish failed");
      return { published: false, error: (err as Error).message };
    }
  },

  async replyToComment(_accountExternalId, commentExternalId, text, credentials): Promise<PublishResult> {
    const accessToken = credentials?.accessToken || env.LINKEDIN_ACCESS_TOKEN;
    const actorUrn = credentials?.organizationUrn || env.LINKEDIN_ORGANIZATION_URN;
    if (!accessToken) {
      logger.warn({ commentExternalId }, "[linkedin] no credentials — logging comment reply instead of sending");
      return { published: false, error: "LinkedIn not connected — reply skipped" };
    }
    try {
      const res = await fetch(`https://api.linkedin.com/v2/socialActions/${commentExternalId}/comments`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify({ actor: actorUrn, message: { text } }),
      });
      if (!res.ok) throw new Error(`comment reply failed (${res.status}): ${await res.text()}`);
      return { published: true };
    } catch (err) {
      logger.error({ err: (err as Error).message }, "[linkedin] comment reply failed");
      return { published: false, error: (err as Error).message };
    }
  },
};
