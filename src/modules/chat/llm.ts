import { env } from "@/config/env";
import { resolveAiKey } from "@/modules/ai-providers/ai-providers.service";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function generateChatCompletion(workspaceId: string, messages: ChatMessage[]): Promise<string> {
  const apiKey = await resolveAiKey(workspaceId, "OPENAI");

  if (!apiKey) {
    return (
      "Thanks for reaching out! I'm still getting set up on this end, so I can't give you a full answer just yet — " +
      "someone from our team will follow up with you shortly."
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
