import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { eventBus } from "@/lib/events";
import { NotFoundError } from "@/lib/errors";
import { workflowQueue } from "./workflow.queue";
import type { WorkflowGraph, WorkflowExecutionContext } from "./workflow.types";
import type { WorkflowStatus } from "@prisma/client";

export async function listWorkflows(workspaceId: string) {
  return prisma.workflow.findMany({ where: { workspaceId }, orderBy: { updatedAt: "desc" } });
}

export async function getWorkflow(workspaceId: string, workflowId: string) {
  const workflow = await prisma.workflow.findFirst({ where: { id: workflowId, workspaceId } });
  if (!workflow) throw new NotFoundError("Workflow not found");
  return workflow;
}

export async function createWorkflow(workspaceId: string, name: string, graph: WorkflowGraph) {
  return prisma.workflow.create({ data: { workspaceId, name, graph: graph as unknown as object, status: "DRAFT" } });
}

export async function updateWorkflow(
  workspaceId: string,
  workflowId: string,
  updates: { name?: string; graph?: WorkflowGraph; status?: WorkflowStatus }
) {
  await getWorkflow(workspaceId, workflowId); // 404 guard
  return prisma.workflow.update({
    where: { id: workflowId },
    data: {
      name: updates.name,
      status: updates.status,
      graph: updates.graph ? (updates.graph as unknown as object) : undefined,
    },
  });
}

export async function deleteWorkflow(workspaceId: string, workflowId: string) {
  await getWorkflow(workspaceId, workflowId);
  await prisma.workflow.delete({ where: { id: workflowId } });
}

export async function listRuns(workspaceId: string, workflowId: string) {
  await getWorkflow(workspaceId, workflowId);
  return prisma.workflowRun.findMany({ where: { workflowId }, orderBy: { createdAt: "desc" }, take: 50 });
}

async function enqueueForEvent(
  workspaceId: string,
  leadId: string,
  event: WorkflowExecutionContext["event"],
  eventPayload: Record<string, unknown>
) {
  const activeWorkflows = await prisma.workflow.findMany({ where: { workspaceId, status: "ACTIVE" } });
  if (activeWorkflows.length === 0) return;

  for (const workflow of activeWorkflows) {
    const run = await prisma.workflowRun.create({
      data: { workflowId: workflow.id, status: "QUEUED", trigger: { event, ...eventPayload } as object },
    });

    await workflowQueue.add("execute", {
      workflowRunId: run.id,
      workflowId: workflow.id,
      ctx: { workspaceId, leadId, event, eventPayload },
    });
  }

  logger.info({ workspaceId, event, count: activeWorkflows.length }, "enqueued workflow runs for event");
}

/** Wires the workflow engine up to lead-lifecycle events. Call once at server startup. */
export function subscribeWorkflowsToEvents() {
  eventBus.onEvent("lead.created", ({ workspaceId, leadId }) => {
    enqueueForEvent(workspaceId, leadId, "new_lead", {}).catch((err) => logger.error({ err }, "enqueue new_lead failed"));
  });

  eventBus.onEvent("lead.message.inbound", ({ workspaceId, leadId, text }) => {
    enqueueForEvent(workspaceId, leadId, "message_received", { text }).catch((err) =>
      logger.error({ err }, "enqueue message_received failed")
    );
  });

  eventBus.onEvent("lead.intent.threshold_crossed", ({ workspaceId, leadId, score }) => {
    enqueueForEvent(workspaceId, leadId, "intent_threshold", { score }).catch((err) =>
      logger.error({ err }, "enqueue intent_threshold failed")
    );
  });

  logger.info("Workflow engine subscribed to lead lifecycle events");
}
