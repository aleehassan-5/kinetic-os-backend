import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock, generateChatCompletionMock } = vi.hoisted(() => {
  const mock: any = {
    lead: { findMany: vi.fn(), count: vi.fn() },
    workflowRun: { findMany: vi.fn() },
    integration: { findMany: vi.fn() },
    meeting: { count: vi.fn() },
  };
  return { prismaMock: mock, generateChatCompletionMock: vi.fn() };
});
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/modules/chat/llm", () => ({ generateChatCompletion: generateChatCompletionMock }));

import { generateCheckin } from "@/modules/dashboard/checkin.service";

function mockAllClear(overrides: Partial<Record<string, any>> = {}) {
  prismaMock.lead.findMany.mockResolvedValue(overrides.highIntentLeads ?? []);
  prismaMock.workflowRun.findMany.mockResolvedValue(overrides.failedRuns ?? []);
  prismaMock.integration.findMany.mockResolvedValue(overrides.brokenIntegrations ?? []);
  prismaMock.meeting.count.mockResolvedValue(overrides.meetingsToday ?? 0);
  prismaMock.lead.count.mockResolvedValue(overrides.customersThisWeek ?? 0);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkin.service — nothing to report", () => {
  it("gives an honest all-clear message without calling the LLM when there's genuinely nothing urgent", async () => {
    mockAllClear();

    const result = await generateCheckin("ws1");

    expect(result.message).toMatch(/nothing needs your attention/i);
    expect(generateChatCompletionMock).not.toHaveBeenCalled(); // no need to spend an LLM call on "all clear"
  });

  it("still mentions real good news (new customers) even when there's nothing urgent", async () => {
    mockAllClear({ customersThisWeek: 3 });

    const result = await generateCheckin("ws1");

    expect(result.message).toContain("3 new customers");
  });
});

describe("checkin.service — real signals trigger a real LLM-generated briefing", () => {
  it("surfaces high-intent leads that haven't been followed up with", async () => {
    mockAllClear({
      highIntentLeads: [{ id: "l1", name: "Fatima", intentScore: 88 }],
    });
    generateChatCompletionMock.mockResolvedValue("Fatima's a hot lead — worth a quick follow-up today.");

    const result = await generateCheckin("ws1");

    expect(result.signals.highIntentUnattendedLeads).toHaveLength(1);
    expect(generateChatCompletionMock).toHaveBeenCalled();
    const promptArg = generateChatCompletionMock.mock.calls[0][0];
    const userMessage = promptArg.find((m: any) => m.role === "user").content;
    expect(userMessage).toContain("Fatima");
  });

  it("groups failed workflow runs by workflow name instead of listing every individual failure", async () => {
    mockAllClear({
      failedRuns: [
        { workflow: { name: "Instagram auto-reply" } },
        { workflow: { name: "Instagram auto-reply" } },
        { workflow: { name: "Lead scoring" } },
      ],
    });
    generateChatCompletionMock.mockResolvedValue("A couple of automated replies didn't go out.");

    const result = await generateCheckin("ws1");

    expect(result.signals.failedWorkflowRuns).toEqual(
      expect.arrayContaining([
        { workflowName: "Instagram auto-reply", count: 2 },
        { workflowName: "Lead scoring", count: 1 },
      ])
    );
  });

  it("surfaces broken integrations that need reconnecting", async () => {
    mockAllClear({ brokenIntegrations: [{ type: "WHATSAPP", detail: "Token expired" }] });
    generateChatCompletionMock.mockResolvedValue("Your WhatsApp connection needs a quick reconnect.");

    const result = await generateCheckin("ws1");

    expect(result.signals.brokenIntegrations).toEqual([{ type: "WHATSAPP", detail: "Token expired" }]);
  });
});
