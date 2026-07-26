import type { Request, Response } from "express";
import * as dashboardService from "./dashboard.service";

export async function getSummaryHandler(req: Request, res: Response) {
  const summary = await dashboardService.getSummary(req.auth!.workspaceId);
  res.status(200).json(summary);
}
