import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { eventBus } from "@/lib/events";
import { NotFoundError, AppError } from "@/lib/errors";
import { workflowQueue } from "./workflow.queue";
import { executeWorkflowGraph } from "./workflow-engine";
import type { WorkflowGraph, WorkflowExecutionContext, WorkflowTriggerData } from "./workflow.types";
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

/**
 * Runs a workflow's graph once, synchronously, against a real lead in the workspace
 * (or the one explicitly provided), with every action handler running in dry-run mode
 * so no real message is sent / CRM synced / notification fired. Used by the "Test run"
 * button in the workflow builder to give an instant, safe preview of what the workflow
 * would do, and records the attempt as a WorkflowRun for the run history.
 */
export async function testRunWorkflow(workspaceId: string, workflowId: string, leadId?: string) {
  const workflow = await getWorkflow(workspaceId, workflowId);
  const graph = workflow.graph as unknown as WorkflowGraph;

  if (!graph?.nodes?.length) {
    throw new AppError("This workflow has no nodes to run yet", 422);
  }

  const triggerNode = graph.nodes.find((n) => n.type === "trigger");
  if (!triggerNode) {
    throw new AppError("This workflow has no trigger node — add one before testing", 422);
  }
  const triggerData = triggerNode.data as WorkflowTriggerData;

  const lead = leadId
    ? await prisma.lead.findFirst({ where: { id: leadId, workspaceId } })
    : await prisma.lead.findFirst({ where: { workspaceId }, orderBy: { lastMessageAt: "desc" } });

  if (!lead) {
    throw new AppError("No leads found in this workspace to test the workflow against yet", 422);
  }

  const ctx: WorkflowExecutionContext = {
    workspaceId,
    leadId: lead.id,
    event: triggerData.event,
    eventPayload: { channel: lead.channel, text: "This is a simulated test message." },
    dryRun: true,
  };

  const startedAt = new Date();
  let logs;
  let status: "SUCCESS" | "FAILED" = "SUCCESS";
  try {
    logs = await executeWorkflowGraph(graph, ctx);
    if (logs.some((l) => l.status === "failed")) status = "FAILED";
  } catch (err) {
    status = "FAILED";
    logs = [
      {
        nodeId: "n/a",
        nodeType: "trigger",
        status: "failed" as const,
        message: err instanceof Error ? err.message : "Test run failed unexpectedly",
        timestamp: new Date().toISOString(),
      },
    ];
  }

  const run = await prisma.workflowRun.create({
    data: {
      workflowId,
      status,
      trigger: { event: ctx.event, test: true, leadId: lead.id } as object,
      logs: logs as unknown as object[],
      startedAt,
      finishedAt: new Date(),
    },
  });

  logger.info({ workflowId, leadId: lead.id, status }, "workflow test run completed");

  return { run, logs, leadUsed: { id: lead.id, name: lead.name, channel: lead.channel } };
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
