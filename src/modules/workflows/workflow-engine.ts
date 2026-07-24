import { prisma } from "@/lib/prisma";
import { executeAction } from "./action-handlers";
import type {
  WorkflowGraph,
  WorkflowNode,
  WorkflowExecutionContext,
  WorkflowConditionData,
  WorkflowLogEntry,
} from "./workflow.types";

function triggerMatches(node: WorkflowNode, ctx: WorkflowExecutionContext): boolean {
  if (node.type !== "trigger") return false;
  const data = node.data as import("./workflow.types").WorkflowTriggerData;
  if (data.event !== ctx.event) return false;
  if (data.channel && data.channel !== "ANY" && data.channel !== ctx.eventPayload.channel) return false;
  return true;
}

async function evaluateCondition(data: WorkflowConditionData, ctx: WorkflowExecutionContext): Promise<boolean> {
  const lead = await prisma.lead.findUnique({ where: { id: ctx.leadId } });
  if (!lead) return false;

  const actual = data.field === "intentScore" ? lead.intentScore : data.field === "channel" ? lead.channel : lead.status;

  switch (data.operator) {
    case "gt":
      return Number(actual) > Number(data.value);
    case "gte":
      return Number(actual) >= Number(data.value);
    case "lt":
      return Number(actual) < Number(data.value);
    case "lte":
      return Number(actual) <= Number(data.value);
    case "eq":
      return String(actual) === String(data.value);
    case "neq":
      return String(actual) !== String(data.value);
    default:
      return false;
  }
}

function outgoingEdges(graph: WorkflowGraph, nodeId: string) {
  return graph.edges.filter((e) => e.source === nodeId);
}

/**
 * Runs one workflow graph for one triggering event. Walks depth-first from
 * every trigger node whose criteria match the event, following condition
 * branches, executing action nodes, and collecting a step-by-step log.
 */
export async function executeWorkflowGraph(graph: WorkflowGraph, ctx: WorkflowExecutionContext): Promise<WorkflowLogEntry[]> {
  const logs: WorkflowLogEntry[] = [];
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();

  async function walk(nodeId: string) {
    if (visited.has(nodeId)) return; // avoid infinite loops on malformed graphs
    visited.add(nodeId);

    const node = nodesById.get(nodeId);
    if (!node) return;

    if (node.type === "condition") {
      const data = node.data as WorkflowConditionData;
      let passed: boolean;
      try {
        passed = await evaluateCondition(data, ctx);
      } catch (err) {
        logs.push({
          nodeId: node.id,
          nodeType: node.type,
          status: "failed",
          message: err instanceof Error ? err.message : "Condition evaluation failed",
          timestamp: new Date().toISOString(),
        });
        return;
      }
      logs.push({
        nodeId: node.id,
        nodeType: node.type,
        status: "success",
        message: `Condition ${data.field} ${data.operator} ${data.value} → ${passed}`,
        timestamp: new Date().toISOString(),
      });

      const branch = passed ? "true" : "false";
      const next = outgoingEdges({ nodes: graph.nodes, edges: graph.edges }, node.id).filter(
        (e) => e.branch === branch || e.branch === undefined
      );
      for (const edge of next) await walk(edge.target);
      return;
    }

    if (node.type === "action") {
      try {
        const message = await executeAction(node.data as import("./workflow.types").WorkflowActionData, ctx);
        logs.push({ nodeId: node.id, nodeType: node.type, status: "success", message, timestamp: new Date().toISOString() });
      } catch (err) {
        logs.push({
          nodeId: node.id,
          nodeType: node.type,
          status: "failed",
          message: err instanceof Error ? err.message : "Action failed",
          timestamp: new Date().toISOString(),
        });
      }
    }

    for (const edge of outgoingEdges(graph, node.id)) await walk(edge.target);
  }

  const matchingTriggers = graph.nodes.filter((n) => triggerMatches(n, ctx));
  for (const trigger of matchingTriggers) {
    logs.push({
      nodeId: trigger.id,
      nodeType: "trigger",
      status: "success",
      message: `Trigger matched: ${ctx.event}`,
      timestamp: new Date().toISOString(),
    });
    for (const edge of outgoingEdges(graph, trigger.id)) await walk(edge.target);
  }

  return logs;
}
