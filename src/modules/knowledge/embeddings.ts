import { createHash } from "crypto";
import { env } from "@/config/env";
import { resolveAiKey } from "@/modules/ai-providers/ai-providers.service";
import { logger } from "@/lib/logger";

const EMBEDDING_DIMENSIONS = 1536;

/**
 * Deterministic pseudo-embedding derived from text hashes. It has no real
 * semantic meaning, but it IS stable and normalized, so cosine similarity
 * still "works" (identical/near-identical text scores highest) — enough to
 * develop and demo the whole RAG pipeline before an OpenAI key exists.
 */
function localFallbackEmbedding(text: string): number[] {
  const vector = new Array(EMBEDDING_DIMENSIONS).fill(0);
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);

  for (const word of words) {
    const hash = createHash("sha256").update(word).digest();
    for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
      vector[i] += hash[i % hash.length] / 255 - 0.5;
    }
  }

  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / magnitude);
}

export async function embedText(workspaceId: string, text: string): Promise<number[]> {
  const apiKey = await resolveAiKey(workspaceId, "OPENAI");
  if (!apiKey) {
    return localFallbackEmbedding(text);
  }

  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: env.OPENAI_EMBEDDING_MODEL, input: text }),
    });

    if (!res.ok) {
      throw new Error(`OpenAI embeddings request failed (${res.status}): ${await res.text()}`);
    }

    const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return data.data[0].embedding;
  } catch (err) {
    // The workspace's configured key is real (resolveAiKey returned one) but
    // isn't necessarily an OpenAI key — Groq and most free OpenAI-compatible
    // providers don't serve embedding models at all, so this 401s/404s even
    // though chat completions work fine with the same key. Fall back to the
    // deterministic local embedding rather than failing the caller outright;
    // search quality degrades, but the feature keeps working.
    logger.warn({ err, workspaceId }, "OpenAI embeddings request failed — using local fallback embedding");
    return localFallbackEmbedding(text);
  }
}

export async function embedBatch(workspaceId: string, texts: string[]): Promise<number[][]> {
  const apiKey = await resolveAiKey(workspaceId, "OPENAI");
  if (!apiKey) {
    return texts.map(localFallbackEmbedding);
  }

  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: env.OPENAI_EMBEDDING_MODEL, input: texts }),
    });

    if (!res.ok) {
      throw new Error(`OpenAI embeddings request failed (${res.status}): ${await res.text()}`);
    }

    const data = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> };
    return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  } catch (err) {
    logger.warn({ err, workspaceId }, "OpenAI embeddings request failed — using local fallback embeddings");
    return texts.map(localFallbackEmbedding);
  }
}
