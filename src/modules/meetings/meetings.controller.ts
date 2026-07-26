import type { Request, Response } from "express";
import * as meetingsService from "./meetings.service";

export async function listHandler(req: Request, res: Response) {
  const meetings = await meetingsService.listMeetings(req.auth!.workspaceId);
  res.status(200).json({ meetings });
}
