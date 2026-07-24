/**
 * Splits text into overlapping chunks sized for embedding models. Uses a
 * word-count approximation of tokens (~0.75 words/token) rather than a real
 * tokenizer — good enough for chunk sizing, not for exact billing.
 */
export function chunkText(text: string, maxTokens = 400, overlapTokens = 50): { content: string; tokenCount: number }[] {
  const words = text.split(/\s+/).filter(Boolean);
  const wordsPerChunk = Math.floor(maxTokens * 0.75);
  const overlapWords = Math.floor(overlapTokens * 0.75);

  if (words.length <= wordsPerChunk) {
    return [{ content: text.trim(), tokenCount: Math.round(words.length / 0.75) }];
  }

  const chunks: { content: string; tokenCount: number }[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + wordsPerChunk, words.length);
    const slice = words.slice(start, end).join(" ");
    chunks.push({ content: slice, tokenCount: Math.round((end - start) / 0.75) });
    if (end === words.length) break;
    start = end - overlapWords;
  }
  return chunks;
}
