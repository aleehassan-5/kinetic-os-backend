import "@/config/env"; // ensure env is validated even when this file runs as its own process
import { initSentry, Sentry, sentryEnabled } from "@/lib/sentry";
initSentry();
import { installCrashSafetyNet } from "@/lib/process-safety-net";
installCrashSafetyNet("workflow-worker");

import { Worker, type Job } from "bullmq";
import { redisConnection } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { executeWorkflowGraph } from "./workflow-engine";
import type { WorkflowJobData } from "./workflow.queue";
import type { WorkflowGraph } from "./workflow.types";

async function processJob(job: Job<WorkflowJobData>) {
  const { workflowRunId, workflowId, ctx } = job.data;

  await prisma.workflowRun.update({ where: { id: workflowRunId }, data: { status: "RUNNING", startedAt: new Date() } });

  const workflow = await prisma.workflow.findUniqueOrThrow({ where: { id: workflowId } });
  const graph = workflow.graph as unknown as WorkflowGraph;

  const logs = await executeWorkflowGraph(graph, ctx);
  const failed = logs.some((l) => l.status === "failed");

  await prisma.workflowRun.update({
    where: { id: workflowRunId },
    data: {
      status: failed ? "FAILED" : "SUCCESS",
      logs: logs as unknown as object[],
      finishedAt: new Date(),
    },
  });

  logger.info({ workflowId, workflowRunId, steps: logs.length, failed }, "workflow run finished");
}

export const workflowWorker = new Worker<WorkflowJobData>("workflow-execution", processJob, {
  connection: redisConnection,
  concurrency: 5,
});

workflowWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, "workflow job failed after retries");
  if (sentryEnabled) Sentry.captureException(err, { extra: { jobId: job?.id, queue: "workflow-execution" } });
});

// Connection-level errors (e.g. Redis dropped) are separate from individual
// job failures above and would otherwise go unreported.
workflowWorker.on("error", (err) => {
  logger.error({ err }, "workflow worker connection error");
  if (sentryEnabled) Sentry.captureException(err, { extra: { queue: "workflow-execution" } });
});

logger.info("Workflow worker started, waiting for jobs…");
