import type { Request, Response } from "express";
import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { isCalendlyConfigured } from "@/lib/calendly";
import { isGoogleCalendarConfigured } from "@/lib/google-calendar";

// Calendly/Google Calendar/HubSpot/Google Sheets are configured once via env
// vars (a single set of credentials shared by the whole deployment), not a
// per-workspace OAuth connection like the messaging channels — so their
// real status comes from whether those env vars are set, not the DB row
// (which stays NOT_CONNECTED forever otherwise since nothing ever writes to it).
function envDrivenStatus(type: string): "CONNECTED" | "NOT_CONNECTED" | null {
  switch (type) {
    case "CALENDLY":
      return isCalendlyConfigured() ? "CONNECTED" : "NOT_CONNECTED";
    case "GOOGLE_CALENDAR":
      return isGoogleCalendarConfigured() ? "CONNECTED" : "NOT_CONNECTED";
    case "HUBSPOT":
      return env.HUBSPOT_ACCESS_TOKEN ? "CONNECTED" : "NOT_CONNECTED";
    case "GOOGLE_SHEETS":
      return env.GOOGLE_SHEETS_SPREADSHEET_ID && env.GOOGLE_SERVICE_ACCOUNT_EMAIL ? "CONNECTED" : "NOT_CONNECTED";
    default:
      return null; // messaging channels: use the real per-workspace DB row as-is
  }
}

export async function listHandler(req: Request, res: Response) {
  const integrations = await prisma.integration.findMany({
    where: { workspaceId: req.auth!.workspaceId },
    select: { id: true, type: true, status: true, detail: true, updatedAt: true },
    orderBy: { type: "asc" },
  });

  const withRealStatus = integrations.map((i) => {
    const overridden = envDrivenStatus(i.type);
    return overridden ? { ...i, status: overridden } : i;
  });

  res.status(200).json({ integrations: withRealStatus });
}
