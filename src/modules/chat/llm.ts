import { env } from "@/config/env";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function generateChatCompletion(messages: ChatMessage[]): Promise<string> {
  if (!env.OPENAI_API_KEY) {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    return (
      "[Local dev mode — no OPENAI_API_KEY set] I'd normally answer using your knowledge base here. " +
      `You asked: "${lastUser?.content ?? ""}". Add OPENAI_API_KEY to .env to get real AI replies.`
    );
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: env.OPENAI_CHAT_MODEL, messages, temperature: 0.4 }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI chat completion failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0].message.content;
}
