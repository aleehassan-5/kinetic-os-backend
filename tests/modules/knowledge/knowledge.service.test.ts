import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock, extractTextFromUrlMock, embedBatchMock } = vi.hoisted(() => {
  const mock: any = {
    knowledgeDocument: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    knowledgeChunk: { deleteMany: vi.fn() },
    $transaction: vi.fn((arg: any) => Promise.all(Array.isArray(arg) ? arg : [])),
    $executeRaw: vi.fn(),
  };
  return { prismaMock: mock, extractTextFromUrlMock: vi.fn(), embedBatchMock: vi.fn() };
});
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/modules/knowledge/embeddings", () => ({ embedBatch: embedBatchMock }));
vi.mock("@/modules/knowledge/file-extraction", () => ({ extractTextFromUrl: extractTextFromUrlMock }));

import { resyncDocument, createDocument } from "@/modules/knowledge/knowledge.service";
import { NotFoundError } from "@/lib/errors";

beforeEach(() => {
  vi.clearAllMocks();
  embedBatchMock.mockResolvedValue([[0.1, 0.2]]);
});

describe("knowledge.service — createDocument", () => {
  it("persists the extracted text so a later re-sync has something to work with", async () => {
    prismaMock.knowledgeDocument.create.mockResolvedValue({ id: "doc1" });

    await createDocument("ws1", { title: "FAQ", sourceType: "FAQ", rawText: "Q: pricing? A: $30/mo" });

    expect(prismaMock.knowledgeDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ rawText: "Q: pricing? A: $30/mo" }) })
    );
  });
});

describe("knowledge.service — resyncDocument", () => {
  it("re-fetches live content for a URL source instead of using stale stored text", async () => {
    prismaMock.knowledgeDocument.findFirst.mockResolvedValue({
      id: "doc1",
      sourceType: "URL",
      sourceUrl: "https://example.com/pricing",
      rawText: "old cached text",
    });
    extractTextFromUrlMock.mockResolvedValue("fresh live text from the page");
    prismaMock.knowledgeDocument.update.mockResolvedValue({});

    await resyncDocument("ws1", "doc1");

    expect(extractTextFromUrlMock).toHaveBeenCalledWith("https://example.com/pricing");
    // The freshly-fetched text should also be saved back, not just used once and discarded.
    expect(prismaMock.knowledgeDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ rawText: "fresh live text from the page" }) })
    );
  });

  it("reuses the stored rawText for non-URL sources (PDF/DOCX/FAQ)", async () => {
    prismaMock.knowledgeDocument.findFirst.mockResolvedValue({
      id: "doc1",
      sourceType: "FAQ",
      sourceUrl: null,
      rawText: "Q: pricing? A: $30/mo",
    });
    prismaMock.knowledgeDocument.update.mockResolvedValue({});

    await resyncDocument("ws1", "doc1");

    expect(extractTextFromUrlMock).not.toHaveBeenCalled();
    expect(embedBatchMock).toHaveBeenCalled(); // ingestion actually ran
  });

  it("fails clearly for a document that predates rawText storage, instead of silently doing nothing", async () => {
    prismaMock.knowledgeDocument.findFirst.mockResolvedValue({
      id: "doc1",
      sourceType: "PDF",
      sourceUrl: null,
      rawText: null, // an old row from before this fix
    });

    await expect(resyncDocument("ws1", "doc1")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("404s for a document that doesn't exist or belongs to another workspace", async () => {
    prismaMock.knowledgeDocument.findFirst.mockResolvedValue(null);
    await expect(resyncDocument("ws1", "nope")).rejects.toBeInstanceOf(NotFoundError);
  });
});
