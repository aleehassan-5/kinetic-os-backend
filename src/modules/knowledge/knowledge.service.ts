import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { NotFoundError } from "@/lib/errors";
import { chunkText } from "./chunking";
import { embedBatch } from "./embeddings";
import type { DocumentSourceType } from "@prisma/client";

export interface CreateDocumentInput {
  title: string;
  sourceType: DocumentSourceType;
  sourceUrl?: string;
  rawText: string;
}

export async function createDocument(workspaceId: string, input: CreateDocumentInput) {
  const document = await prisma.knowledgeDocument.create({
    data: {
      workspaceId,
      title: input.title,
      sourceType: input.sourceType,
      sourceUrl: input.sourceUrl,
      status: "QUEUED",
      storageBytes: Buffer.byteLength(input.rawText, "utf8"),
    },
  });

  // Fire-and-forget: ingestion runs async so the upload request returns
  // immediately (the frontend shows "Processing" via the status field).
  ingestDocument(document.id, input.rawText).catch((err) => {
    logger.error({ err, documentId: document.id }, "knowledge document ingestion failed");
  });

  return document;
}

export async function ingestDocument(documentId: string, rawText: string) {
  await prisma.knowledgeDocument.update({ where: { id: documentId }, data: { status: "PROCESSING" } });

  try {
    const chunks = chunkText(rawText);
    const embeddings = await embedBatch(chunks.map((c) => c.content));

    await prisma.$transaction(
      chunks.map((chunk, i) => {
        const id = randomUUID();
        const vectorLiteral = `[${embeddings[i].join(",")}]`;
        return prisma.$executeRaw`
          INSERT INTO "KnowledgeChunk" (id, "documentId", content, "tokenCount", embedding, "createdAt")
          VALUES (${id}, ${documentId}, ${chunk.content}, ${chunk.tokenCount}, ${vectorLiteral}::vector, now())
        `;
      })
    );

    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: "INDEXED", chunkCount: chunks.length },
    });
  } catch (err) {
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: "FAILED", error: err instanceof Error ? err.message : "Unknown ingestion error" },
    });
    throw err;
  }
}

export async function listDocuments(workspaceId: string) {
  return prisma.knowledgeDocument.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } });
}

export async function deleteDocument(workspaceId: string, documentId: string) {
  const doc = await prisma.knowledgeDocument.findFirst({ where: { id: documentId, workspaceId } });
  if (!doc) throw new NotFoundError("Document not found");
  await prisma.knowledgeDocument.delete({ where: { id: documentId } });
}

export async function resyncDocument(workspaceId: string, documentId: string, rawText: string) {
  const doc = await prisma.knowledgeDocument.findFirst({ where: { id: documentId, workspaceId } });
  if (!doc) throw new NotFoundError("Document not found");
  await prisma.knowledgeChunk.deleteMany({ where: { documentId } });
  await ingestDocument(documentId, rawText);
}

export interface RetrievedChunk {
  id: string;
  content: string;
  documentId: string;
  documentTitle: string;
  distance: number;
}

/** Cosine-distance nearest-neighbor search across a workspace's indexed chunks. */
export async function retrieveRelevantChunks(workspaceId: string, queryEmbedding: number[], topK = 5): Promise<RetrievedChunk[]> {
  const vectorLiteral = `[${queryEmbedding.join(",")}]`;

  return prisma.$queryRaw<RetrievedChunk[]>`
    SELECT c.id, c.content, c."documentId", d.title AS "documentTitle",
           (c.embedding <=> ${vectorLiteral}::vector) AS distance
    FROM "KnowledgeChunk" c
    JOIN "KnowledgeDocument" d ON d.id = c."documentId"
    WHERE d."workspaceId" = ${workspaceId} AND d.status = 'INDEXED'
    ORDER BY c.embedding <=> ${vectorLiteral}::vector
    LIMIT ${topK}
  `;
}
