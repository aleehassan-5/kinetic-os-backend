import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock, generateChatCompletionMock, createPostMock } = vi.hoisted(() => {
  const mock: any = {
    listing: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
    socialPost: { update: vi.fn() },
  };
  return { prismaMock: mock, generateChatCompletionMock: vi.fn(), createPostMock: vi.fn() };
});
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/modules/chat/llm", () => ({ generateChatCompletion: generateChatCompletionMock }));
vi.mock("@/modules/social/social.service", () => ({ createPost: createPostMock }));

import { proposeAndGenerateContentPlan } from "@/modules/listings/listings.service";
import { NotFoundError } from "@/lib/errors";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.listing.findFirst.mockResolvedValue({
    id: "listing1",
    title: "3-bed apartment in DHA",
    description: "Modern finishes, great light",
    priceLabel: "$450,000",
    location: "DHA Phase 6",
  });
  prismaMock.socialPost.update.mockResolvedValue({});
});

describe("listings.service — content plan generation", () => {
  it("creates real draft posts from a well-formed AI plan, tagged with the listing", async () => {
    generateChatCompletionMock.mockResolvedValue(
      JSON.stringify({
        audience: "Young professionals looking to buy in DHA.",
        posts: [
          { title: "Tour the apartment", platform: "INSTAGRAM", contentType: "REEL", prompt: "Show off the natural light." },
          { title: "Price highlight", platform: "FACEBOOK", contentType: "STATIC_GRAPHIC", prompt: "Highlight the price vs comparable listings." },
        ],
      })
    );
    createPostMock.mockImplementation(async (_ws, input) => ({ id: `post-${input.title}`, ...input }));

    const result = await proposeAndGenerateContentPlan("ws1", "listing1", ["INSTAGRAM", "FACEBOOK"], 2);

    expect(result.audience).toContain("DHA");
    expect(result.posts).toHaveLength(2);
    expect(createPostMock).toHaveBeenCalledWith(
      "ws1",
      expect.objectContaining({ platform: "INSTAGRAM", contentType: "REEL", useVoiceover: true, mode: "draft" })
    );
    // Every generated post gets tagged back to the listing it came from.
    expect(prismaMock.socialPost.update).toHaveBeenCalledTimes(2);
  });

  it("strips markdown code fences if the model wraps its JSON response", async () => {
    generateChatCompletionMock.mockResolvedValue(
      "```json\n" + JSON.stringify({ audience: "Buyers in the area.", posts: [{ title: "Post", platform: "INSTAGRAM", contentType: "STATIC_GRAPHIC", prompt: "x" }] }) + "\n```"
    );
    createPostMock.mockResolvedValue({ id: "post1" });

    const result = await proposeAndGenerateContentPlan("ws1", "listing1", ["INSTAGRAM"], 1);

    expect(result.audience).toBe("Buyers in the area.");
  });

  it("falls back to a simple deterministic plan instead of crashing when the LLM response isn't valid JSON", async () => {
    generateChatCompletionMock.mockResolvedValue("[Local dev mode — no OPENAI_API_KEY set] some non-JSON text");
    createPostMock.mockResolvedValue({ id: "post1" });

    const result = await proposeAndGenerateContentPlan("ws1", "listing1", ["INSTAGRAM"], 2);

    expect(result.posts).toHaveLength(2);
    expect(result.audience).toContain("3-bed apartment in DHA");
  });

  it("404s for a listing that doesn't exist or belongs to another workspace", async () => {
    prismaMock.listing.findFirst.mockResolvedValue(null);

    await expect(proposeAndGenerateContentPlan("ws1", "nope", ["INSTAGRAM"], 1)).rejects.toBeInstanceOf(NotFoundError);
    expect(generateChatCompletionMock).not.toHaveBeenCalled(); // shouldn't even reach the LLM call
  });
});
