import { Queue } from "bullmq";
import { redisConnection } from "@/lib/redis";
import { AppError } from "@/lib/errors";

export interface SocialPublishJobData {
  postId: string;
}

export const socialPublishQueue = new Queue<SocialPublishJobData>("social-publish", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 500,
    removeOnFail: 1000,
  },
});

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new AppError(message, 503)), ms)),
  ]);
}

/** Schedules (or reschedules) a post's publish job to fire at `scheduledAt`. */
export async function enqueuePublishJob(postId: string, scheduledAt: Date): Promise<string> {
  const delay = Math.max(0, scheduledAt.getTime() - Date.now());
  const job = await withTimeout(
    socialPublishQueue.add("publish", { postId }, { delay, jobId: `social-publish:${postId}` }),
    5000,
    "Couldn't schedule this post — the scheduling queue (Redis) isn't reachable. Set REDIS_URL to a running Redis instance and make sure the social worker process is running."
  );
  return job.id ?? `social-publish:${postId}`;
}

export async function cancelPublishJob(jobId: string | null): Promise<void> {
  if (!jobId) return;
  const job = await socialPublishQueue.getJob(jobId);
  if (job) await job.remove();
}
