import { Router } from "express";
import type { Request, Response } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { logger } from "@/lib/logger";
import { verifyMetaAppSecretSignature, verifyMetaWebhookChallenge } from "@/modules/channels/meta-messaging.shared";
import { resolveWorkspaceForSocialAccount, handleInboundComment } from "./social.service";
import type { InboundComment } from "./social.types";

const router = Router();

// Meta (Instagram + Facebook) comment webhooks share the same "changes" envelope.
interface MetaCommentWebhookBody {
  entry?: Array<{
    id: string; // the IG business account id / FB page id the event is for
    changes?: Array<{
      field: string;
      value: {
        id?: string; // comment id (Instagram)
        comment_id?: string; // comment id (Facebook)
        text?: string;
        message?: string;
        from?: { id?: string; username?: string; name?: string };
        media?: { id?: string };
        post_id?: string;
        item?: string;
      };
    }>;
  }>;
}

async function handleMetaCommentWebhook(platform: "INSTAGRAM" | "FACEBOOK", req: Request, res: Response) {
  const rawBody = (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body);
  if (!verifyMetaAppSecretSignature(rawBody, req.headers as Record<string, string | string[] | undefined>)) {
    logger.warn({ platform }, "[social-webhooks] signature verification failed");
    return res.status(401).json({ error: "Invalid signature" });
  }

  const payload = req.body as MetaCommentWebhookBody;
  let processed = 0;

  for (const entry of payload.entry ?? []) {
    const account = await resolveWorkspaceForSocialAccount(platform, entry.id);
    if (!account) continue;

    for (const change of entry.changes ?? []) {
      const isComment =
        platform === "INSTAGRAM" ? change.field === "comments" : change.value.item === "comment" || change.field === "feed";
      if (!isComment) continue;

      const text = change.value.text ?? change.value.message;
      const commentExternalId = change.value.id ?? change.value.comment_id;
      if (!text || !commentExternalId) continue;

      const comment: InboundComment = {
        platform,
        accountExternalId: entry.id,
        postExternalId: change.value.post_id ?? change.value.media?.id,
        commentExternalId,
        authorName: change.value.from?.username ?? change.value.from?.name,
        text,
      };

      await handleInboundComment(account.workspaceId, account.id, comment);
      processed++;
    }
  }

  res.status(200).json({ received: true, processed });
}

router.get("/instagram-comments", (req: Request, res: Response) => {
  const challenge = verifyMetaWebhookChallenge(req.query as Record<string, string>);
  if (challenge === null) return res.status(403).send("Verification failed");
  res.status(200).send(challenge);
});
router.post("/instagram-comments", asyncHandler((req, res) => handleMetaCommentWebhook("INSTAGRAM", req, res)));

router.get("/facebook-comments", (req: Request, res: Response) => {
  const challenge = verifyMetaWebhookChallenge(req.query as Record<string, string>);
  if (challenge === null) return res.status(403).send("Verification failed");
  res.status(200).send(challenge);
});
router.post("/facebook-comments", asyncHandler((req, res) => handleMetaCommentWebhook("FACEBOOK", req, res)));

export default router;
