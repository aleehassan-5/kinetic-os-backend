import type { Request, Response } from "express";
import { prisma } from "@/lib/prisma";

// Scheduling/CRM providers (Calendly, Google Calendar, HubSpot, Google Sheets)
// now live under /scheduling-crm with their own connect/test/disconnect flow.
// This endpoint stays for messaging-channel status only (used by the
// Integrations settings page alongside /channel-connections).
export async function listHandler(req: Request, res: Response) {
  const integrations = await prisma.integration.findMany({
    where: { workspaceId: req.auth!.workspaceId },
    select: { id: true, type: true, status: true, detail: true, updatedAt: true },
    orderBy: { type: "asc" },
  });

  res.status(200).json({ integrations });
}
