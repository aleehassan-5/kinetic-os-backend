import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => {
  const mock: any = { message: { findMany: vi.fn(), count: vi.fn() } };
  return { prismaMock: mock };
});
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { getVoiceExamples, getVoiceProfileStatus, buildVoiceInstruction } from "@/modules/chat/voice-profile";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("voice-profile — getVoiceExamples", () => {
  it("only pulls human-sent (AGENT) replies, never AI-generated ones", async () => {
    prismaMock.message.findMany.mockResolvedValue([{ content: "Hey, thanks for reaching out!" }]);

    await getVoiceExamples("ws1");

    expect(prismaMock.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ sender: "AGENT", direction: "OUTBOUND" }) })
    );
  });

  it("filters out empty or oversized outlier messages", async () => {
    prismaMock.message.findMany.mockResolvedValue([
      { content: "" },
      { content: "  " },
      { content: "a".repeat(600) }, // too long, would dominate the prompt
      { content: "Sure, I can do 3pm tomorrow." },
    ]);

    const examples = await getVoiceExamples("ws1");

    expect(examples).toEqual(["Sure, I can do 3pm tomorrow."]);
  });
});

describe("voice-profile — status and prompt building", () => {
  it("reports the profile as not active below the minimum example threshold", async () => {
    prismaMock.message.count.mockResolvedValue(2);
    const status = await getVoiceProfileStatus("ws1");
    expect(status).toEqual({ exampleCount: 2, active: false });
  });

  it("reports the profile as active once enough examples exist", async () => {
    prismaMock.message.count.mockResolvedValue(7);
    const status = await getVoiceProfileStatus("ws1");
    expect(status).toEqual({ exampleCount: 7, active: true });
  });

  it("stays generic (returns null) rather than personalizing off too little signal", async () => {
    prismaMock.message.findMany.mockResolvedValue([{ content: "Thanks!" }, { content: "Sure thing." }]);
    const instruction = await buildVoiceInstruction("ws1");
    expect(instruction).toBeNull();
  });

  it("builds a real instruction quoting the owner's actual past messages once there's enough signal", async () => {
    const realReplies = [
      "Hey! Thanks for reaching out, happy to help.",
      "Sure, let's do 3pm tomorrow if that works for you.",
      "Appreciate the patience — sending the details now.",
      "Absolutely, I'll follow up with pricing shortly.",
      "Good morning! Let me check and get back to you.",
    ];
    prismaMock.message.findMany.mockResolvedValue(realReplies.map((content) => ({ content })));

    const instruction = await buildVoiceInstruction("ws1");

    expect(instruction).not.toBeNull();
    expect(instruction).toContain(realReplies[0]);
    expect(instruction).toMatch(/sounds like it came from this same person/i);
  });
});
