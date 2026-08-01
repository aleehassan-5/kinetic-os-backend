import type { Request, Response } from "express";
import type { SchedulingCrmType } from "./scheduling-crm.schema";
import { connectSchedulingCrmSchema } from "./scheduling-crm.schema";
import * as schedulingCrmService from "./scheduling-crm.service";

export async function listSchedulingCrmHandler(req: Request, res: Response) {
  const items = await schedulingCrmService.listSchedulingCrm(req.auth!.workspaceId);
  res.status(200).json({ items });
}

export async function connectSchedulingCrmHandler(req: Request, res: Response) {
  const input = connectSchedulingCrmSchema.parse(req.body);
  const result = await schedulingCrmService.connectSchedulingCrm(req.auth!.workspaceId, input);
  res.status(200).json(result);
}

export async function testSchedulingCrmHandler(req: Request, res: Response) {
  const input = connectSchedulingCrmSchema.parse(req.body);
  const result = await schedulingCrmService.testSchedulingCrm(input);
  res.status(200).json(result);
}

export async function disconnectSchedulingCrmHandler(req: Request, res: Response) {
  const result = await schedulingCrmService.disconnectSchedulingCrm(req.auth!.workspaceId, req.params.type as SchedulingCrmType);
  res.status(200).json(result);
}
