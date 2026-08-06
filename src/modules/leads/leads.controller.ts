import type { Request, Response } from "express";
import { listLeadsQuerySchema, replySchema, updateLeadSchema, scheduleMeetingSchema, logCallSchema } from "./leads.schema";
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

export async function updateLeadHandler(req: Request, res: Response) {
  const input = updateLeadSchema.parse(req.body);
  const lead = await leadsService.updateLead(req.auth!.workspaceId, req.params.leadId, input);
  res.status(200).json(lead);
}

export async function scheduleMeetingHandler(req: Request, res: Response) {
  const input = scheduleMeetingSchema.parse(req.body);
  const meeting = await leadsService.scheduleMeeting(req.auth!.workspaceId, req.params.leadId, input);
  res.status(201).json(meeting);
}

export async function logCallHandler(req: Request, res: Response) {
  const { notes } = logCallSchema.parse(req.body);
  const message = await leadsService.logCall(req.auth!.workspaceId, req.params.leadId, notes);
  res.status(201).json(message);
}
