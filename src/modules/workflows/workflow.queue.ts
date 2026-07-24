import { Queue } from "bullmq";
import { redisConnection } from "@/lib/redis";
import type { WorkflowExecutionContext } from "./workflow.types";

export interface WorkflowJobData {
  workflowRunId: string;
  workflowId: string;
  ctx: WorkflowExecutionContext;
}

export const workflowQueue = new Queue<WorkflowJobData>("workflow-execution", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 500,
    removeOnFail: 1000,
  },
});
