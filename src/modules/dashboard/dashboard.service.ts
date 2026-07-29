import { prisma } from "@/lib/prisma";

const DAY_MS = 24 * 60 * 60 * 1000;

function pctChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * Aggregates real workspace data for the dashboard overview.
 * Replaces the old hardcoded fixture numbers on the frontend — every
 * value here comes from actual Lead/Message/Meeting rows.
 */
export async function getSummary(workspaceId: string) {
  const now = new Date();
  const start30 = new Date(now.getTime() - 30 * DAY_MS);
  const start60 = new Date(now.getTime() - 60 * DAY_MS);
  const start7 = new Date(now.getTime() - 7 * DAY_MS);

  const [
    leadsLast30,
    leadsPrev30,
    meetingsLast30,
    meetingsPrev30,
    channelGroups,
    messagesLast30,
  ] = await Promise.all([
    prisma.lead.findMany({
      where: { workspaceId, createdAt: { gte: start30 } },
      select: { id: true, intentScore: true, channel: true, createdAt: true },
    }),
    prisma.lead.count({
      where: { workspaceId, createdAt: { gte: start60, lt: start30 } },
    }),
    prisma.meeting.count({
      where: { lead: { workspaceId }, createdAt: { gte: start30 }, status: { in: ["CONFIRMED", "COMPLETED"] } },
    }),
    prisma.meeting.count({
      where: { lead: { workspaceId }, createdAt: { gte: start60, lt: start30 }, status: { in: ["CONFIRMED", "COMPLETED"] } },
    }),
    prisma.lead.groupBy({
      by: ["channel"],
      where: { workspaceId, createdAt: { gte: start30 } },
      _count: { _all: true },
    }),
    prisma.message.findMany({
      where: {
        conversation: { workspaceId },
        createdAt: { gte: start30 },
      },
      select: { direction: true, sender: true, createdAt: true },
    }),
  ]);

  // Reply rate: of inbound (lead) messages, what fraction got an AI/agent outbound reply
  // in the same conversation window. We approximate at the workspace level using
  // inbound vs outbound message counts, which is stable and cheap to compute.
  type LeadRow = (typeof leadsLast30)[number];
  type MessageRow = (typeof messagesLast30)[number];
  type ChannelGroupRow = (typeof channelGroups)[number];

  const inboundCount = messagesLast30.filter((m: MessageRow) => m.direction === "INBOUND").length;
  const outboundCount = messagesLast30.filter((m: MessageRow) => m.direction === "OUTBOUND").length;
  const aiReplyRate = inboundCount === 0 ? 0 : Math.min(100, Math.round((outboundCount / inboundCount) * 1000) / 10);

  // Outcome framing: every automated reply is a reply the owner didn't have to
  // type himself. MINUTES_SAVED_PER_REPLY is a deliberately conservative
  // estimate (reading the inbound message, thinking, and typing a reply by
  // hand) so this stays a defensible number, not a marketing exaggeration.
  const MINUTES_SAVED_PER_REPLY = 6;
  const outboundPrev30 = await prisma.message.count({
    where: {
      conversation: { workspaceId },
      direction: "OUTBOUND",
      createdAt: { gte: start60, lt: start30 },
    },
  });
  const hoursReclaimed = Math.round(((outboundCount * MINUTES_SAVED_PER_REPLY) / 60) * 10) / 10;
  const hoursReclaimedPrev = Math.round(((outboundPrev30 * MINUTES_SAVED_PER_REPLY) / 60) * 10) / 10;

  const avgIntentScore =
    leadsLast30.length === 0
      ? 0
      : Math.round(leadsLast30.reduce((sum: number, l: LeadRow) => sum + l.intentScore, 0) / leadsLast30.length);

  const totalChannelLeads = channelGroups.reduce((sum: number, g: ChannelGroupRow) => sum + g._count._all, 0);
  const channelBreakdown = channelGroups
    .map((g: ChannelGroupRow) => ({
      channel: g.channel,
      count: g._count._all,
      pct: totalChannelLeads === 0 ? 0 : Math.round((g._count._all / totalChannelLeads) * 1000) / 10,
    }))
    .sort((a: { count: number }, b: { count: number }) => b.count - a.count);

  // Last 7 days: leads captured vs AI/agent replies sent, per day, for the chart.
  const days: { date: string; leads: number; replies: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(now.getTime() - i * DAY_MS);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    const dateKey = dayStart.toISOString().slice(0, 10);

    const leadsThatDay = leadsLast30.filter((l: LeadRow) => l.createdAt >= dayStart && l.createdAt < dayEnd).length;
    const repliesThatDay = messagesLast30.filter(
      (m: MessageRow) => m.direction === "OUTBOUND" && m.createdAt >= dayStart && m.createdAt < dayEnd
    ).length;

    days.push({ date: dateKey, leads: leadsThatDay, replies: repliesThatDay });
  }

  return {
    newLeads: {
      value: leadsLast30.length,
      deltaPct: pctChange(leadsLast30.length, leadsPrev30),
    },
    aiReplyRate: {
      value: aiReplyRate,
      deltaPct: null, // no cheap prior-period comparison without a second full message scan; frontend hides the delta when null
    },
    hoursReclaimed: {
      value: hoursReclaimed,
      deltaPct: pctChange(hoursReclaimed, hoursReclaimedPrev),
    },
    meetingsBooked: {
      value: meetingsLast30,
      deltaPct: pctChange(meetingsLast30, meetingsPrev30),
    },
    avgIntentScore: {
      value: avgIntentScore,
      deltaPct: null,
    },
    channelBreakdown,
    leadVolume7d: days,
    generatedAt: now.toISOString(),
  };
}
