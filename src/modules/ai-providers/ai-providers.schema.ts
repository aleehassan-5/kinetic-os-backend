import { z } from "zod";

export const aiProviderSchema = z.enum(["OPENAI", "ANTHROPIC", "ELEVENLABS"]);

export const connectAiProviderSchema = z.object({
  provider: aiProviderSchema,
  apiKey: z.string().min(1, "API key is required"),
});

export type AiProvider = z.infer<typeof aiProviderSchema>;
export type ConnectAiProviderInput = z.infer<typeof connectAiProviderSchema>;
