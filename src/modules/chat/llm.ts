import { env } from "@/config/env";
import { resolveAiKey } from "@/modules/ai-providers/ai-providers.service";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function generateChatCompletion(workspaceId: string, messages: ChatMessage[]): Promise<string> {
  const apiKey = await resolveAiKey(workspaceId, "OPENAI");

  if (!apiKey) {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    return (
      "[Local dev mode — no OpenAI key configured] I'd normally answer using your knowledge base here. " +
      `You asked: "${lastUser?.content ?? ""}". Connect an OpenAI key in Settings → AI Providers to get real AI replies.`
    );
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: env.OPENAI_CHAT_MODEL, messages, temperature: 0.4 }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI chat completion failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0].message.content;
}
