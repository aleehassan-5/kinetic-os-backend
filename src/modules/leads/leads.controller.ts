import type { Request, Response } from "express";
import { listLeadsQuerySchema, replySchema } from "./leads.schema";
import * as leadsService from "./leads.service";

export async function listLeadsHandler(req: Request, res: Response) {
  const filters = listLeadsQuerySchema.parse(req.query);
  const result = await leadsService.listLeads(req.auth!.workspaceId, filters);
  res.status(200).json(result);
}

export async function getLeadHandler(req: Request, res: Response) {
  const lead = await leadsService.getLeadWithConversation(req.auth!.workspaceId, req.params.leadId);
  res.status(200).json(lead);
}

export async function replyHandler(req: Request, res: Response) {
  const { text } = replySchema.parse(req.body);
  const result = await leadsService.sendReply(req.auth!.workspaceId, req.params.leadId, text, "AGENT");
  res.status(201).json(result);
}
