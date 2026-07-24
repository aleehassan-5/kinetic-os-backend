import { Queue } from "bullmq";
import { redisConnection } from "@/lib/redis";

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

/** Schedules (or reschedules) a post's publish job to fire at `scheduledAt`. */
export async function enqueuePublishJob(postId: string, scheduledAt: Date): Promise<string> {
  const delay = Math.max(0, scheduledAt.getTime() - Date.now());
  const job = await socialPublishQueue.add("publish", { postId }, { delay, jobId: `social-publish:${postId}` });
  return job.id ?? `social-publish:${postId}`;
}

export async function cancelPublishJob(jobId: string | null): Promise<void> {
  if (!jobId) return;
  const job = await socialPublishQueue.getJob(jobId);
  if (job) await job.remove();
}
