import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { NotFoundError } from "@/lib/errors";
import { createNotification } from "@/modules/notifications/notifications.service";
import { answerWithKnowledgeBase } from "@/modules/chat/chat.service";
import type { SocialPlatform, SocialContentType } from "@prisma/client";
import { generatePostAssets } from "./content-generation";
import { generateVoiceover } from "./voiceover";
import { assembleReelVideo, isFfmpegAvailable } from "@/lib/video-assembly";
import { getPublisher } from "./publishers/registry";
import { enqueuePublishJob, cancelPublishJob } from "./social.queue";
import type { InboundComment } from "./social.types";

// ── Posts ──────────────────────────────────────────────────────────────

export async function listPosts(workspaceId: string, filters: { status?: string; platform?: string }) {
  return prisma.socialPost.findMany({
    where: {
      workspaceId,
      ...(filters.status ? { status: filters.status as never } : {}),
      ...(filters.platform ? { platform: filters.platform as never } : {}),
    },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
  });
}

export async function getPost(workspaceId: string, postId: string) {
  const post = await prisma.socialPost.findFirst({ where: { id: postId, workspaceId } });
  if (!post) throw new NotFoundError("Post not found");
  return post;
}

interface CreatePostInput {
  title: string;
  platform: SocialPlatform;
  contentType: SocialContentType;
  prompt?: string;
  useVoiceover: boolean;
  scheduledAt?: string;
  mode: "draft" | "generate_and_schedule";
}

export async function createPost(workspaceId: string, input: CreatePostInput) {
  const account = await prisma.socialAccount.findUnique({
    where: { workspaceId_platform: { workspaceId, platform: input.platform } },
  });

  const post = await prisma.socialPost.create({
    data: {
      workspaceId,
      accountId: account?.id,
      platform: input.platform,
      contentType: input.contentType,
      title: input.title,
      prompt: input.prompt,
      useVoiceover: input.useVoiceover,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      status: "DRAFT",
    },
  });

  if (input.mode === "draft") return post;

  return generateAndSchedulePost(workspaceId, post.id);
}

/** Runs AI generation (graphic/script/voiceover) for a post, then schedules or immediately publishes it. */
export async function generateAndSchedulePost(workspaceId: string, postId: string) {
  const post = await getPost(workspaceId, postId);

  await prisma.socialPost.update({ where: { id: post.id }, data: { status: "GENERATING", error: null } });

  try {
    const assets = await generatePostAssets(post.title, post.prompt ?? undefined, post.contentType);

    let voiceoverUrl: string | null = null;
    let mediaUrl = assets.mediaUrl;
    const isVideoPost = post.contentType === "REEL" || post.contentType === "STORY";

    if (post.useVoiceover && assets.script) {
      const voice = await generateVoiceover(assets.script);
      voiceoverUrl = voice.voiceoverUrl;

      if (isVideoPost && voiceoverUrl) {
        try {
          if (await isFfmpegAvailable()) {
            mediaUrl = await assembleReelVideo(assets.mediaUrl, voiceoverUrl);
          } else {
            logger.warn(
              { postId: post.id },
              "[social] ffmpeg not installed on this server — publishing the still graphic instead of an assembled reel video"
            );
          }
        } catch (err) {
          logger.error(
            { err: (err as Error).message, postId: post.id },
            "[social] reel video assembly failed — falling back to the still graphic"
          );
        }
      }
    }

    const scheduledAt = post.scheduledAt ?? new Date();
    const isDue = scheduledAt.getTime() <= Date.now();

    const updated = await prisma.socialPost.update({
      where: { id: post.id },
      data: {
        caption: assets.caption,
        script: assets.script,
        mediaUrl,
        voiceoverUrl,
        scheduledAt,
        status: isDue ? "GENERATING" : "SCHEDULED",
      },
    });

    if (isDue) {
      return publishPost(workspaceId, updated.id);
    }

    const jobId = await enqueuePublishJob(updated.id, scheduledAt);
    await prisma.socialPost.update({ where: { id: updated.id }, data: { jobId } });

    await createNotification(workspaceId, {
      type: "SYSTEM",
      title: "Post generated & scheduled",
      description: `"${post.title}" was generated and scheduled for ${post.platform.toLowerCase()}.`,
    });

    return prisma.socialPost.findUniqueOrThrow({ where: { id: updated.id } });
  } catch (err) {
    logger.error({ err: (err as Error).message, postId: post.id }, "[social] generation failed");
    return prisma.socialPost.update({
      where: { id: post.id },
      data: { status: "FAILED", error: (err as Error).message },
    });
  }
}

/** Publishes a (generated) post to its platform right now. Called by the worker at the scheduled time, or on-demand. */
export async function publishPost(workspaceId: string, postId: string) {
  const post = await getPost(workspaceId, postId);
  const account = post.accountId ? await prisma.socialAccount.findUnique({ where: { id: post.accountId } }) : null;

  const publisher = getPublisher(post.platform);
  const result = await publisher.publish({
    externalAccountId: account?.externalId ?? null,
    caption: post.caption ?? post.title,
    mediaUrl: post.mediaUrl,
    voiceoverUrl: post.voiceoverUrl,
    isVideo: post.mediaUrl?.endsWith(".mp4") ?? false,
  });

  const updated = await prisma.socialPost.update({
    where: { id: post.id },
    data: result.published
      ? { status: "PUBLISHED", publishedAt: new Date(), externalPostId: result.externalPostId, error: null }
      : { status: "FAILED", error: result.error ?? "Publish failed" },
  });

  await createNotification(workspaceId, {
    type: result.published ? "SYSTEM" : "SYSTEM",
    title: result.published ? "Post published" : "Post publish failed",
    description: result.published
      ? `"${post.title}" went live on ${post.platform.toLowerCase()}.`
      : `"${post.title}" failed to publish on ${post.platform.toLowerCase()}: ${result.error ?? "unknown error"}`,
  });

  return updated;
}

export async function updatePost(
  workspaceId: string,
  postId: string,
  input: { title?: string; caption?: string; script?: string; scheduledAt?: string | null }
) {
  const post = await getPost(workspaceId, postId);

  const nextScheduledAt = input.scheduledAt === undefined ? post.scheduledAt : input.scheduledAt ? new Date(input.scheduledAt) : null;

  const updated = await prisma.socialPost.update({
    where: { id: post.id },
    data: {
      title: input.title ?? post.title,
      caption: input.caption ?? post.caption,
      script: input.script ?? post.script,
      scheduledAt: nextScheduledAt,
    },
  });

  // Reschedule the publish job if the time changed and the post is still queued.
  if (input.scheduledAt !== undefined && post.status === "SCHEDULED") {
    await cancelPublishJob(post.jobId);
    if (nextScheduledAt) {
      const jobId = await enqueuePublishJob(updated.id, nextScheduledAt);
      await prisma.socialPost.update({ where: { id: updated.id }, data: { jobId } });
    }
  }

  return updated;
}

export async function deletePost(workspaceId: string, postId: string) {
  const post = await getPost(workspaceId, postId);
  await cancelPublishJob(post.jobId);
  await prisma.socialPost.delete({ where: { id: post.id } });
  return { deleted: true };
}

// ── Accounts ───────────────────────────────────────────────────────────

export async function listAccounts(workspaceId: string) {
  return prisma.socialAccount.findMany({ where: { workspaceId } });
}

export async function connectAccount(
  workspaceId: string,
  input: { platform: SocialPlatform; externalId: string; displayName?: string; autoReplyComments: boolean }
) {
  return prisma.socialAccount.upsert({
    where: { workspaceId_platform: { workspaceId, platform: input.platform } },
    update: {
      status: "CONNECTED",
      externalId: input.externalId,
      displayName: input.displayName,
      autoReplyComments: input.autoReplyComments,
    },
    create: {
      workspaceId,
      platform: input.platform,
      status: "CONNECTED",
      externalId: input.externalId,
      displayName: input.displayName,
      autoReplyComments: input.autoReplyComments,
    },
  });
}

// ── Comment engagement (active listening + auto-reply) ───────────────────

/** Resolves which workspace a platform + external account id belongs to. */
export async function resolveWorkspaceForSocialAccount(platform: SocialPlatform, externalAccountId: string) {
  const account = await prisma.socialAccount.findFirst({
    where: { platform, externalId: externalAccountId, status: "CONNECTED" },
  });
  return account;
}

/**
 * Handles an inbound comment on a published post: stores it, and — if the
 * connected account has auto-reply enabled — generates a knowledge-base-
 * grounded reply and posts it back via the platform's publisher.
 */
export async function handleInboundComment(workspaceId: string, accountId: string, comment: InboundComment) {
  const existing = await prisma.socialComment.findUnique({
    where: { accountId_externalCommentId: { accountId, externalCommentId: comment.commentExternalId } },
  });
  if (existing) return existing;

  const post = comment.postExternalId
    ? await prisma.socialPost.findFirst({ where: { workspaceId, externalPostId: comment.postExternalId } })
    : null;

  const stored = await prisma.socialComment.create({
    data: {
      workspaceId,
      accountId,
      postId: post?.id,
      platform: comment.platform,
      externalCommentId: comment.commentExternalId,
      authorName: comment.authorName,
      text: comment.text,
      status: "NEW",
    },
  });

  const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: accountId } });
  if (!account.autoReplyComments) return stored;

  try {
    const { reply } = await answerWithKnowledgeBase(workspaceId, [{ role: "user", content: comment.text }]);
    const publisher = getPublisher(comment.platform);
    const result = await publisher.replyToComment(comment.accountExternalId, comment.commentExternalId, reply);

    return prisma.socialComment.update({
      where: { id: stored.id },
      data: {
        status: result.published ? "REPLIED" : "FAILED",
        aiReply: reply,
        repliedAt: result.published ? new Date() : undefined,
      },
    });
  } catch (err) {
    logger.error({ err: (err as Error).message, commentId: stored.id }, "[social] auto-reply failed");
    return prisma.socialComment.update({ where: { id: stored.id }, data: { status: "FAILED" } });
  }
}

export async function listComments(workspaceId: string) {
  return prisma.socialComment.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 100 });
}
