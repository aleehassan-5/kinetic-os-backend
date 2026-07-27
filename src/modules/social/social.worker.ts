import "@/config/env"; // ensure env is validated even when this file runs as its own process
import { initSentry, Sentry, sentryEnabled } from "@/lib/sentry";
initSentry();
import { installCrashSafetyNet } from "@/lib/process-safety-net";
installCrashSafetyNet("social-worker");

import { Worker, type Job } from "bullmq";
import { redisConnection } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { publishPost } from "./social.service";
import type { SocialPublishJobData } from "./social.queue";

async function processJob(job: Job<SocialPublishJobData>) {
  const { postId } = job.data;

  const post = await prisma.socialPost.findUnique({ where: { id: postId } });
  if (!post) {
    logger.warn({ postId }, "[social-worker] post no longer exists — skipping job");
    return;
  }
  if (post.status === "PUBLISHED") {
    logger.info({ postId }, "[social-worker] post already published — skipping");
    return;
  }

  await publishPost(post.workspaceId, post.id);
  logger.info({ postId }, "[social-worker] publish job finished");
}

export const socialWorker = new Worker<SocialPublishJobData>("social-publish", processJob, {
  connection: redisConnection,
  concurrency: 3,
});

socialWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, "[social-worker] publish job failed after retries");
  if (sentryEnabled) Sentry.captureException(err, { extra: { jobId: job?.id, queue: "social-publish" } });
});

socialWorker.on("error", (err) => {
  logger.error({ err }, "[social-worker] connection error");
  if (sentryEnabled) Sentry.captureException(err, { extra: { queue: "social-publish" } });
});

logger.info("Social publish worker started, waiting for jobs…");
