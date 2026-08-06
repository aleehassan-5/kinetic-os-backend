import { prisma } from "@/lib/prisma";
import { eventBus } from "@/lib/events";
import { logger } from "@/lib/logger";
import { NotFoundError } from "@/lib/errors";
import { scoreIntent } from "./intent-scoring";
import { getAdapter } from "@/modules/channels/registry";
import { getChannelCredentials } from "@/modules/channels/channel-connections.service";
import type { InboundMessage } from "@/modules/channels/types";
import { createNotification } from "@/modules/notifications/notifications.service";
import type { LeadStatus } from "@prisma/client";

const HIGH_INTENT_THRESHOLD = 80;

/** Core ingestion pipeline every channel webhook funnels into. */
export async function handleInboundMessage(workspaceId: string, inbound: InboundMessage) {
  const lead = await prisma.lead.upsert({
    where: { workspaceId_channel_externalId: { workspaceId, channel: inbound.channel, externalId: inbound.externalId } },
    update: { name: inbound.name ?? undefined, lastMessageAt: inbound.timestamp },
    create: {
      workspaceId,
      channel: inbound.channel,
      externalId: inbound.externalId,
      name: inbound.name,
      status: "NEW",
      lastMessageAt: inbound.timestamp,
    },
  });

  const isNewLead = lead.createdAt.getTime() === lead.updatedAt.getTime();

  let conversation = await prisma.conversation.findFirst({
    where: { leadId: lead.id },
    orderBy: { createdAt: "desc" },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { workspaceId, leadId: lead.id, channel: inbound.channel },
    });
  } else {
    await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: inbound.timestamp } });
  }

  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "INBOUND",
      sender: "LEAD",
      content: inbound.text,
      meta: { raw: inbound.raw as object },
    },
  });

  const { score, matchedKeywords } = scoreIntent(inbound.text, lead.intentScore);
  const crossedThreshold = lead.intentScore < HIGH_INTENT_THRESHOLD && score >= HIGH_INTENT_THRESHOLD;

  const nextStatus: LeadStatus = lead.status === "NEW" ? "ENGAGED" : lead.status;
  await prisma.lead.update({ where: { id: lead.id }, data: { intentScore: score, status: nextStatus } });

  logger.info({ leadId: lead.id, channel: inbound.channel, score, matchedKeywords }, "inbound message scored");

  if (isNewLead) {
    eventBus.emitEvent("lead.created", { workspaceId, leadId: lead.id });
  }
  eventBus.emitEvent("lead.message.inbound", {
    workspaceId,
    leadId: lead.id,
    conversationId: conversation.id,
    messageId: message.id,
    text: inbound.text,
  });

  if (crossedThreshold) {
    eventBus.emitEvent("lead.intent.threshold_crossed", { workspaceId, leadId: lead.id, score });
    await createNotification(workspaceId, {
      type: "LEAD",
      title: "New high-intent lead",
      description: `${lead.name ?? "A lead"} on ${inbound.channel} just crossed an intent score of ${score}.`,
    });
  }

  return { lead, conversation, message, isNewLead };
}

export interface ListLeadsFilters {
  channel?: string;
  status?: string;
  search?: string;
  minIntentScore?: number;
  sortBy?: "recent" | "intentScore";
  page?: number;
  pageSize?: number;
}

export async function listLeads(workspaceId: string, filters: ListLeadsFilters) {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 25;

  const where = {
    workspaceId,
    ...(filters.channel ? { channel: filters.channel as never } : {}),
    ...(filters.status ? { status: filters.status as never } : {}),
    ...(typeof filters.minIntentScore === "number" ? { intentScore: { gte: filters.minIntentScore } } : {}),
    ...(filters.search
      ? {
          OR: [
            { name: { contains: filters.search, mode: "insensitive" as const } },
            { email: { contains: filters.search, mode: "insensitive" as const } },
            { phone: { contains: filters.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const orderBy = filters.sortBy === "intentScore" ? { intentScore: "desc" as const } : { lastMessageAt: "desc" as const };

  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.lead.count({ where }),
  ]);

  return { leads, total, page, pageSize };
}

export async function getLeadWithConversation(workspaceId: string, leadId: string) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, workspaceId },
    include: {
      conversations: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { messages: { orderBy: { createdAt: "asc" } } },
      },
      meetings: { orderBy: { startTime: "desc" } },
    },
  });
  if (!lead) throw new NotFoundError("Lead not found");
  return lead;
}

export async function sendReply(workspaceId: string, leadId: string, text: string, sender: "AI" | "AGENT" = "AGENT") {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, workspaceId } });
  if (!lead) throw new NotFoundError("Lead not found");

  const conversation = await prisma.conversation.findFirst({ where: { leadId }, orderBy: { createdAt: "desc" } });
  if (!conversation) throw new NotFoundError("No conversation found for this lead");

  const adapter = getAdapter(lead.channel);
  const credentials = await getChannelCredentials(workspaceId, lead.channel);
  const result = await adapter.sendMessage({ externalId: lead.externalId, text }, credentials);

  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "OUTBOUND",
      sender,
      content: text,
      meta: { delivered: result.delivered, providerMessageId: result.providerMessageId ?? null },
    },
  });

  return { message, delivered: result.delivered };
}

export async function updateLead(
  workspaceId: string,
  leadId: string,
  input: { status?: LeadStatus; dealValue?: number | null }
) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, workspaceId } });
  if (!lead) throw new NotFoundError("Lead not found");

  const wasAlreadyClosed = lead.status === "CLOSED";

  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.dealValue !== undefined
        ? { dealValueCents: input.dealValue === null ? null : Math.round(input.dealValue * 100) }
        : {}),
    },
  });

  if (input.status === "CLOSED" && !wasAlreadyClosed) {
    await createNotification(workspaceId, {
      type: "LEAD",
      title: "New customer added",
      description: `${lead.name ?? lead.email ?? "A lead"} was marked as closed/won.`,
    });
  }

  return updated;
}

export async function scheduleMeeting(
  workspaceId: string,
  leadId: string,
  input: { topic?: string; startTime: Date; endTime: Date; meetingUrl?: string }
) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, workspaceId } });
  if (!lead) throw new NotFoundError("Lead not found");

  const meeting = await prisma.meeting.create({
    data: {
      leadId,
      source: "MANUAL",
      status: "CONFIRMED",
      topic: input.topic ?? null,
      startTime: input.startTime,
      endTime: input.endTime,
      meetingUrl: input.meetingUrl ?? null,
    },
  });

  if (lead.status === "NEW" || lead.status === "ENGAGED") {
    await prisma.lead.update({ where: { id: leadId }, data: { status: "MEETING_BOOKED" } });
  }

  return meeting;
}

export async function logCall(workspaceId: string, leadId: string, notes: string) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, workspaceId } });
  if (!lead) throw new NotFoundError("Lead not found");

  const conversation = await prisma.conversation.findFirst({
    where: { leadId },
    orderBy: { createdAt: "desc" },
  });
  if (!conversation) throw new NotFoundError("No conversation found for this lead");

  return prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "OUTBOUND",
      sender: "SYSTEM",
      content: `📞 Call logged: ${notes}`,
    },
  });
}
