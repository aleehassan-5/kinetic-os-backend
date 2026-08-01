import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock, answerWithKnowledgeBaseMock, sendReplyMock, createNotificationMock, appendRowMock } = vi.hoisted(() => {
  const mock: any = {
    conversation: { findFirst: vi.fn() },
    lead: { findUniqueOrThrow: vi.fn() },
    // Added for scheduling-crm.service.ts's getIntegrationCredentials() — the
    // calendar_book "not configured" tests exercise this path directly.
    integration: { findUnique: vi.fn() },
  };
  return {
    prismaMock: mock,
    answerWithKnowledgeBaseMock: vi.fn(),
    sendReplyMock: vi.fn(),
    createNotificationMock: vi.fn(),
    appendRowMock: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/modules/chat/chat.service", () => ({ answerWithKnowledgeBase: answerWithKnowledgeBaseMock }));
vi.mock("@/modules/leads/leads.service", () => ({ sendReply: sendReplyMock }));
vi.mock("@/modules/notifications/notifications.service", () => ({ createNotification: createNotificationMock }));
vi.mock("@/lib/google-sheets", () => ({ appendRow: appendRowMock }));

import { executeAction } from "@/modules/workflows/action-handlers";
import type { WorkflowActionData, WorkflowExecutionContext } from "@/modules/workflows/workflow.types";

const baseCtx: WorkflowExecutionContext = {
  workspaceId: "ws1",
  leadId: "lead1",
  event: "new_lead",
  eventPayload: {},
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("workflow engine — dry run must never call real integrations", () => {
  it("ai_reply dry run calls the LLM (to preview the reply) but never actually sends a message", async () => {
    prismaMock.conversation.findFirst.mockResolvedValue({
      id: "c1",
      messages: [{ sender: "LEAD", content: "hi, how much does this cost?" }],
    });
    answerWithKnowledgeBaseMock.mockResolvedValue({ reply: "It starts at $30/month." });

    const result = await executeAction({ actionType: "ai_reply" }, { ...baseCtx, dryRun: true });

    expect(result).toContain("(dry run)");
    expect(result).toContain("$30/month");
    expect(sendReplyMock).not.toHaveBeenCalled(); // the whole point of dry run
  });

  it("crm_sync dry run never calls the real HubSpot/Sheets API", async () => {
    prismaMock.lead.findUniqueOrThrow.mockResolvedValue({ id: "lead1", name: "Ali", email: "ali@example.com" });

    const result = await executeAction(
      { actionType: "crm_sync", integration: "GOOGLE_SHEETS" },
      { ...baseCtx, dryRun: true }
    );

    expect(result).toContain("(dry run)");
    expect(result).toContain("Ali");
    expect(appendRowMock).not.toHaveBeenCalled();
  });

  it("calendar_book dry run never generates a real Calendly link or Google Calendar event", async () => {
    const result = await executeAction(
      { actionType: "calendar_book", provider: "CALENDLY" },
      { ...baseCtx, dryRun: true }
    );

    expect(result).toContain("(dry run)");
    expect(sendReplyMock).not.toHaveBeenCalled();
  });

  it("notify dry run never creates a real notification row", async () => {
    const result = await executeAction(
      { actionType: "notify", template: "Lead {name} needs follow-up" },
      { ...baseCtx, dryRun: true }
    );

    expect(result).toContain("(dry run)");
    expect(createNotificationMock).not.toHaveBeenCalled();
  });
});

describe("workflow engine — real execution", () => {
  it("ai_reply sends a real reply grounded in the knowledge base when not a dry run", async () => {
    prismaMock.conversation.findFirst.mockResolvedValue({ id: "c1", messages: [] });
    answerWithKnowledgeBaseMock.mockResolvedValue({ reply: "Sure, happy to help!" });
    sendReplyMock.mockResolvedValue({ delivered: true });

    const result = await executeAction({ actionType: "ai_reply" }, baseCtx);

    expect(sendReplyMock).toHaveBeenCalledWith("ws1", "lead1", "Sure, happy to help!", "AI");
    expect(result).toContain("delivered: true");
  });

  it("ai_reply skips cleanly when the lead has no conversation yet, instead of crashing", async () => {
    prismaMock.conversation.findFirst.mockResolvedValue(null);

    const result = await executeAction({ actionType: "ai_reply" }, baseCtx);

    expect(result).toMatch(/no conversation/i);
    expect(sendReplyMock).not.toHaveBeenCalled();
  });

  it("calendar_book skips (doesn't crash) when Calendly isn't configured", async () => {
    // .env.test leaves CALENDLY_ACCESS_TOKEN unset, so isCalendlyConfigured() is false.
    const result = await executeAction({ actionType: "calendar_book", provider: "CALENDLY" }, baseCtx);
    expect(result).toMatch(/not connected/i);
  });

  it("calendar_book skips (doesn't crash) when Google Calendar isn't configured", async () => {
    const result = await executeAction({ actionType: "calendar_book", provider: "GOOGLE_CALENDAR" }, baseCtx);
    expect(result).toMatch(/not connected/i);
  });

  it("unknown action types are skipped, not thrown, so one bad node can't crash the whole workflow run", async () => {
    const result = await executeAction({ actionType: "made_up_action" as WorkflowActionData["actionType"] }, baseCtx);
    expect(result).toMatch(/unknown action type/i);
  });
});
