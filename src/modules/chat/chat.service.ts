import { embedText } from "@/modules/knowledge/embeddings";
import { retrieveRelevantChunks } from "@/modules/knowledge/knowledge.service";
import { generateChatCompletion, type ChatMessage } from "./llm";
import { buildVoiceInstruction } from "./voice-profile";
import { logger } from "@/lib/logger";

const BASE_SYSTEM_PROMPT = `You are the Kinetic OS assistant, a helpful assistant answering questions strictly using the provided context from the business's knowledge base. If the answer isn't in the context, say you don't have that information yet instead of guessing. Keep answers concise and friendly.`;

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResult {
  reply: string;
  sources: { documentTitle: string; snippet: string }[];
}

export async function answerWithKnowledgeBase(workspaceId: string, history: ChatTurn[]): Promise<ChatResult> {
  const lastUserMessage = [...history].reverse().find((m) => m.role === "user");
  if (!lastUserMessage) {
    return { reply: "What would you like to know?", sources: [] };
  }

  // Embeddings need a real OpenAI key specifically (Groq and most free
  // OpenAI-compatible providers don't serve embedding models). If that's
  // not configured, skip knowledge-base grounding instead of failing the
  // whole chat — the assistant still replies, just without KB context.
  let chunks: Awaited<ReturnType<typeof retrieveRelevantChunks>> = [];
  try {
    const queryEmbedding = await embedText(workspaceId, lastUserMessage.content);
    chunks = await retrieveRelevantChunks(workspaceId, queryEmbedding, 5);
  } catch (err) {
    logger.warn({ err }, "Knowledge-base embedding lookup failed — answering without KB context");
  }

  const context = chunks.length
    ? chunks.map((c, i) => `[${i + 1}] (from "${c.documentTitle}")\n${c.content}`).join("\n\n")
    : "No knowledge base documents are indexed yet.";

  const voiceInstruction = await buildVoiceInstruction(workspaceId);

  const messages: ChatMessage[] = [
    { role: "system", content: BASE_SYSTEM_PROMPT },
    ...(voiceInstruction ? [{ role: "system" as const, content: voiceInstruction }] : []),
    { role: "system", content: `Context:\n${context}` },
    ...history.map((h) => ({ role: h.role, content: h.content }) as ChatMessage),
  ];

  const reply = await generateChatCompletion(workspaceId, messages);

  return {
    reply,
    sources: chunks.map((c) => ({ documentTitle: c.documentTitle, snippet: c.content.slice(0, 180) })),
  };
}
