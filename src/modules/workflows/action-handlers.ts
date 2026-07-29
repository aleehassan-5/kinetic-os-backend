import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { env } from "@/config/env";
import { answerWithKnowledgeBase } from "@/modules/chat/chat.service";
import { sendReply } from "@/modules/leads/leads.service";
import { createNotification } from "@/modules/notifications/notifications.service";
import { appendRow } from "@/lib/google-sheets";
import { createSchedulingLink, isCalendlyConfigured } from "@/lib/calendly";
import { createCalendarEvent, isGoogleCalendarConfigured } from "@/lib/google-calendar";
import type { WorkflowActionData, WorkflowExecutionContext } from "./workflow.types";

export async function executeAction(action: WorkflowActionData, ctx: WorkflowExecutionContext): Promise<string> {
  switch (action.actionType) {
    case "ai_reply":
      return runAiReply(ctx);
    case "crm_sync":
      return runCrmSync(action, ctx);
    case "calendar_book":
      return runCalendarBook(action, ctx);
    case "notify":
      return runNotify(action, ctx);
    default:
      return `Unknown action type — skipped`;
  }
}

async function runAiReply(ctx: WorkflowExecutionContext): Promise<string> {
  const conversation = await prisma.conversation.findFirst({
    where: { leadId: ctx.leadId },
    orderBy: { createdAt: "desc" },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 20 } },
  });
  if (!conversation) return "No conversation found for lead — skipped";

  const history = conversation.messages.map((m: { sender: string; content: string }) => ({
    role: (m.sender === "LEAD" ? "user" : "assistant") as "user" | "assistant",
    content: m.content,
  }));

  const { reply } = await answerWithKnowledgeBase(ctx.workspaceId, history);

  if (ctx.dryRun) {
    return `(dry run) Would send AI reply: "${reply.slice(0, 120)}${reply.length > 120 ? "…" : ""}"`;
  }

  const result = await sendReply(ctx.workspaceId, ctx.leadId, reply, "AI");
  return `AI reply sent (delivered: ${result.delivered})`;
}

async function runCrmSync(action: WorkflowActionData, ctx: WorkflowExecutionContext): Promise<string> {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: ctx.leadId } });

  if (ctx.dryRun) {
    return `(dry run) Would sync lead "${lead.name ?? lead.id}" to ${action.integration ?? "no CRM configured"}`;
  }

  if (action.integration === "HUBSPOT") {
    if (!env.HUBSPOT_ACCESS_TOKEN) {
      logger.warn({ leadId: lead.id }, "[crm-sync] HubSpot not configured — logging instead of syncing");
      return "HubSpot not connected — sync skipped (would upsert contact)";
    }
    await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.HUBSPOT_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        properties: { email: lead.email ?? undefined, phone: lead.phone ?? undefined, firstname: lead.name ?? undefined },
      }),
    });
    return "Synced lead to HubSpot";
  }

  if (action.integration === "GOOGLE_SHEETS") {
    if (!env.GOOGLE_SHEETS_SPREADSHEET_ID || !env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
      logger.warn({ leadId: lead.id }, "[crm-sync] Google Sheets not configured — logging instead of syncing");
      return "Google Sheets not connected — sync skipped (would append row)";
    }
    await appendRow([
      lead.id,
      lead.name ?? "",
      lead.email ?? "",
      lead.phone ?? "",
      lead.channel,
      lead.status,
      String(lead.intentScore),
      new Date().toISOString(),
    ]);
    return "Synced lead to Google Sheets";
  }

  return "No CRM integration specified — skipped";
}

async function runCalendarBook(action: WorkflowActionData, ctx: WorkflowExecutionContext): Promise<string> {
  if (ctx.dryRun) {
    return `(dry run) Would generate a booking link via ${action.provider ?? "default provider"}`;
  }

  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: ctx.leadId } });

  if (action.provider === "CALENDLY") {
    if (!isCalendlyConfigured()) {
      return "Calendly not connected — booking skipped";
    }
    const bookingUrl = await createSchedulingLink(lead.id);
    // The Meeting row for this gets created by the /webhooks/calendly
    // `invitee.created` handler once the lead actually books a time —
    // we only know a real start/end time at that point.
    await sendReply(
      ctx.workspaceId,
      lead.id,
      `Here's a link to grab a time that works for you: ${bookingUrl}`,
      "AI"
    );
    return `Real Calendly booking link sent to lead: ${bookingUrl}`;
  }

  if (action.provider === "GOOGLE_CALENDAR") {
    if (!isGoogleCalendarConfigured()) {
      return "Google Calendar not connected — booking skipped";
    }
    // No live availability picker for a direct Calendar booking (unlike
    // Calendly), so we propose the next business day at 2pm workspace time,
    // 30 minutes — action.durationMinutes/proposedStartTime can override this.
    const startTime = action.proposedStartTime ? new Date(action.proposedStartTime) : nextBusinessDayAt(14);
    const durationMinutes = action.durationMinutes ?? 30;
    const endTime = new Date(startTime.getTime() + durationMinutes * 60_000);

    const event = await createCalendarEvent({
      summary: `Call with ${lead.name ?? lead.email ?? "lead"}`,
      description: `Booked automatically by Kinetic OS for lead ${lead.id}.`,
      startTime,
      endTime,
      attendeeEmail: lead.email,
    });

    await prisma.meeting.create({
      data: {
        leadId: lead.id,
        source: "GOOGLE_CALENDAR",
        status: "CONFIRMED",
        topic: `Call with ${lead.name ?? lead.email ?? "lead"}`,
        startTime,
        endTime,
        meetingUrl: event.htmlLink,
      },
    });

    await sendReply(
      ctx.workspaceId,
      lead.id,
      `You're booked for ${startTime.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}. Details: ${event.htmlLink}`,
      "AI"
    );
    return `Real Google Calendar event created and lead notified: ${event.htmlLink}`;
  }

  return `No calendar provider specified — skipped`;
}

/** Next weekday (Mon–Fri) at the given hour, UTC — used when no explicit time is proposed. */
function nextBusinessDayAt(hourUtc: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d;
}

async function runNotify(action: WorkflowActionData, ctx: WorkflowExecutionContext): Promise<string> {
  if (ctx.dryRun) {
    return `(dry run) Would create notification: "${action.template ?? "Workflow action triggered"}"`;
  }
  await createNotification(ctx.workspaceId, {
    type: "WORKFLOW",
    title: "Workflow action triggered",
    description: action.template ?? `A workflow action ran for lead ${ctx.leadId}.`,
  });
  return "Notification created";
}
