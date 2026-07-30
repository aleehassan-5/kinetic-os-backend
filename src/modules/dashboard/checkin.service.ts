import { prisma } from "@/lib/prisma";
import { generateChatCompletion } from "@/modules/chat/llm";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CheckinSignals {
  highIntentUnattendedLeads: { id: string; name: string | null; intentScore: number }[];
  failedWorkflowRuns: { workflowName: string; count: number }[];
  brokenIntegrations: { type: string; detail: string | null }[];
  meetingsToday: number;
  customersThisWeek: number;
}

/**
 * Pulls the real signals a trusted ops manager would actually check for you
 * — not a canned list, an actual query against this workspace's data. Kept
 * separate from the message-generation step below so the raw facts are
 * independently inspectable/testable regardless of what the LLM does with them.
 */
export async function gatherCheckinSignals(workspaceId: string): Promise<CheckinSignals> {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart.getTime() + DAY_MS);
  const start7 = new Date(now.getTime() - 7 * DAY_MS);
  const start24h = new Date(now.getTime() - DAY_MS);

  const [highIntentUnattended, recentFailedRuns, brokenIntegrations, meetingsToday, customersThisWeek] =
    await Promise.all([
      prisma.lead.findMany({
        where: { workspaceId, intentScore: { gte: 70 }, status: { in: ["NEW", "ENGAGED"] } },
        select: { id: true, name: true, intentScore: true },
        orderBy: { intentScore: "desc" },
        take: 5,
      }),
      prisma.workflowRun.findMany({
        where: { workflow: { workspaceId }, status: "FAILED", createdAt: { gte: start24h } },
        select: { workflow: { select: { name: true } } },
      }),
      prisma.integration.findMany({
        where: { workspaceId, status: "ERROR" },
        select: { type: true, detail: true },
      }),
      prisma.meeting.count({
        where: { lead: { workspaceId }, startTime: { gte: todayStart, lt: todayEnd }, status: { in: ["CONFIRMED", "PENDING"] } },
      }),
      prisma.lead.count({
        where: { workspaceId, status: "CLOSED", updatedAt: { gte: start7 } },
      }),
    ]);

  const failedByWorkflow = new Map<string, number>();
  for (const run of recentFailedRuns) {
    const name = run.workflow.name;
    failedByWorkflow.set(name, (failedByWorkflow.get(name) ?? 0) + 1);
  }

  return {
    highIntentUnattendedLeads: highIntentUnattended,
    failedWorkflowRuns: Array.from(failedByWorkflow.entries()).map(([workflowName, count]) => ({ workflowName, count })),
    brokenIntegrations,
    meetingsToday,
    customersThisWeek,
  };
}

function hasNothingToReport(signals: CheckinSignals): boolean {
  return (
    signals.highIntentUnattendedLeads.length === 0 &&
    signals.failedWorkflowRuns.length === 0 &&
    signals.brokenIntegrations.length === 0
  );
}

const CHECKIN_SYSTEM_PROMPT = `You are a trusted operations manager giving a business owner a short, plain-language check-in about their business — the way a real person would, not a software status page. Be warm but brief (3-5 sentences max). Lead with anything that needs the owner's attention first, mention genuinely good news if there is any, and end with one concrete suggested next action if there's something worth doing. Never use technical jargon like "workflow", "integration", or "API" — describe things the way the owner would think about them (e.g. "a few messages didn't get automated replies" instead of "workflow run failed").`;

/**
 * Generates the actual check-in message. Real signals in, real
 * plain-language message out — this is the thing the pitch describes as a
 * conversational assistant that "checks in...prompting next actions", not a
 * static dashboard widget with a chat icon on it.
 */
export async function generateCheckin(workspaceId: string): Promise<{ message: string; signals: CheckinSignals }> {
  const signals = await gatherCheckinSignals(workspaceId);

  if (hasNothingToReport(signals)) {
    const positivePart =
      signals.customersThisWeek > 0
        ? `Nice work — ${signals.customersThisWeek} new customer${signals.customersThisWeek === 1 ? "" : "s"} this week. `
        : "";
    const meetingsPart = signals.meetingsToday > 0 ? `You've got ${signals.meetingsToday} meeting${signals.meetingsToday === 1 ? "" : "s"} today. ` : "";
    return {
      message: `${positivePart}${meetingsPart}Everything else looks like it's running smoothly — nothing needs your attention right now.`,
      signals,
    };
  }

  const factsForPrompt = [
    signals.highIntentUnattendedLeads.length > 0
      ? `${signals.highIntentUnattendedLeads.length} high-interest lead(s) haven't been followed up with yet: ${signals.highIntentUnattendedLeads.map((l) => l.name ?? "an unnamed lead").join(", ")}.`
      : null,
    signals.failedWorkflowRuns.length > 0
      ? `Some automated replies didn't go out in the last 24 hours: ${signals.failedWorkflowRuns.map((f) => `"${f.workflowName}" failed ${f.count} time(s)`).join(", ")}.`
      : null,
    signals.brokenIntegrations.length > 0
      ? `These connected accounts have a problem and need reconnecting: ${signals.brokenIntegrations.map((i) => i.type).join(", ")}.`
      : null,
    signals.meetingsToday > 0 ? `${signals.meetingsToday} meeting(s) scheduled today.` : null,
    signals.customersThisWeek > 0 ? `${signals.customersThisWeek} new customer(s) this week.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const message = await generateChatCompletion([
    { role: "system", content: CHECKIN_SYSTEM_PROMPT },
    { role: "user", content: `Here's what's actually happening in the business right now: ${factsForPrompt}` },
  ]);

  return { message, signals };
}
