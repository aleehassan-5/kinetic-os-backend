import { embedText } from "@/modules/knowledge/embeddings";
import { retrieveRelevantChunks } from "@/modules/knowledge/knowledge.service";
import { generateChatCompletion, type ChatMessage } from "./llm";

const SYSTEM_PROMPT = `You are the Kinetic OS assistant, a helpful assistant answering questions strictly using the provided context from the business's knowledge base. If the answer isn't in the context, say you don't have that information yet instead of guessing. Keep answers concise and friendly.`;

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

  const queryEmbedding = await embedText(lastUserMessage.content);
  const chunks = await retrieveRelevantChunks(workspaceId, queryEmbedding, 5);

  const context = chunks.length
    ? chunks.map((c, i) => `[${i + 1}] (from "${c.documentTitle}")\n${c.content}`).join("\n\n")
    : "No knowledge base documents are indexed yet.";

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: `Context:\n${context}` },
    ...history.map((h) => ({ role: h.role, content: h.content }) as ChatMessage),
  ];

  const reply = await generateChatCompletion(messages);

  return {
    reply,
    sources: chunks.map((c) => ({ documentTitle: c.documentTitle, snippet: c.content.slice(0, 180) })),
  };
}
