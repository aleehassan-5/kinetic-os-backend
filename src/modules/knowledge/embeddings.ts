import { createHash } from "crypto";
import { env } from "@/config/env";

const EMBEDDING_DIMENSIONS = 1536;

/**
 * Deterministic pseudo-embedding derived from text hashes. It has no real
 * semantic meaning, but it IS stable and normalized, so cosine similarity
 * still "works" (identical/near-identical text scores highest) — enough to
 * develop and demo the whole RAG pipeline before an OPENAI_API_KEY exists.
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

export async function embedText(text: string): Promise<number[]> {
  if (!env.OPENAI_API_KEY) {
    return localFallbackEmbedding(text);
  }

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: env.OPENAI_EMBEDDING_MODEL, input: text }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI embeddings request failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return data.data[0].embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (!env.OPENAI_API_KEY) {
    return texts.map(localFallbackEmbedding);
  }

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: env.OPENAI_EMBEDDING_MODEL, input: texts }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI embeddings request failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> };
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}
