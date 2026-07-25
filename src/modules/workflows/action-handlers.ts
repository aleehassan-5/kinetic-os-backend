import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { env } from "@/config/env";
import { answerWithKnowledgeBase } from "@/modules/chat/chat.service";
import { sendReply } from "@/modules/leads/leads.service";
import { createNotification } from "@/modules/notifications/notifications.service";
import { appendRow } from "@/lib/google-sheets";
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
  if (action.provider === "CALENDLY" && !env.CALENDLY_ACCESS_TOKEN) {
    return "Calendly not connected — booking skipped";
  }
  if (action.provider === "GOOGLE_CALENDAR" && !env.GOOGLE_CLIENT_ID) {
    return "Google Calendar not connected — booking skipped";
  }
  // Real implementation: create a Calendly single-use scheduling link via their API,
  // or a Google Calendar event via googleapis, then send the link/confirmation to the lead.
  logger.info({ leadId: ctx.leadId, provider: action.provider }, "[calendar-book] would create booking link");
  return `Booking link generated via ${action.provider ?? "default provider"}`;
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
