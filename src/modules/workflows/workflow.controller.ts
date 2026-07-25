import type { Request, Response } from "express";
import { createWorkflowSchema, updateWorkflowSchema } from "./workflow.schema";
import * as workflowService from "./workflow.service";
import type { WorkflowGraph } from "./workflow.types";

export async function listHandler(req: Request, res: Response) {
  const workflows = await workflowService.listWorkflows(req.auth!.workspaceId);
  res.status(200).json({ workflows });
}

export async function getHandler(req: Request, res: Response) {
  const workflow = await workflowService.getWorkflow(req.auth!.workspaceId, req.params.workflowId);
  res.status(200).json(workflow);
}

export async function createHandler(req: Request, res: Response) {
  const input = createWorkflowSchema.parse(req.body);
  const workflow = await workflowService.createWorkflow(req.auth!.workspaceId, input.name, input.graph as WorkflowGraph);
  res.status(201).json(workflow);
}

export async function updateHandler(req: Request, res: Response) {
  const input = updateWorkflowSchema.parse(req.body);
  const workflow = await workflowService.updateWorkflow(req.auth!.workspaceId, req.params.workflowId, {
    ...input,
    graph: input.graph as WorkflowGraph | undefined,
  });
  res.status(200).json(workflow);
}

export async function deleteHandler(req: Request, res: Response) {
  await workflowService.deleteWorkflow(req.auth!.workspaceId, req.params.workflowId);
  res.status(204).send();
}

export async function listRunsHandler(req: Request, res: Response) {
  const runs = await workflowService.listRuns(req.auth!.workspaceId, req.params.workflowId);
  res.status(200).json({ runs });
}

export async function testRunHandler(req: Request, res: Response) {
  const leadId = typeof req.body?.leadId === "string" ? req.body.leadId : undefined;
  const result = await workflowService.testRunWorkflow(req.auth!.workspaceId, req.params.workflowId, leadId);
  res.status(200).json(result);
}
