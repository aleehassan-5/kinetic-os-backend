import { prisma } from "@/lib/prisma";

/** Below this many real examples, we don't have enough signal to imitate a style yet — stay generic rather than fake it off 1-2 samples. */
const MIN_EXAMPLES_FOR_ACTIVE_PROFILE = 5;
const MAX_EXAMPLES_IN_PROMPT = 8;

/**
 * Pulls the owner's own most recent human-sent replies (Message rows with
 * sender="AGENT" — i.e. actually typed and sent by a person, not the AI)
 * across the workspace's conversations. These are real evidence of how
 * this specific owner actually writes: greeting style, formality,
 * sentence length, emoji use, sign-offs — the "learns the owner's tone"
 * claim, backed by real data instead of a generic prompt.
 */
export async function getVoiceExamples(workspaceId: string, limit = MAX_EXAMPLES_IN_PROMPT): Promise<string[]> {
  const messages = await prisma.message.findMany({
    where: {
      sender: "AGENT",
      direction: "OUTBOUND",
      conversation: { workspaceId },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { content: true },
  });

  return messages
    .map((m) => m.content.trim())
    .filter((c) => c.length > 0 && c.length < 500); // skip empty/oversized outliers that would dominate the prompt
}

export async function getVoiceProfileStatus(workspaceId: string): Promise<{ exampleCount: number; active: boolean }> {
  const exampleCount = await prisma.message.count({
    where: { sender: "AGENT", direction: "OUTBOUND", conversation: { workspaceId } },
  });
  return { exampleCount, active: exampleCount >= MIN_EXAMPLES_FOR_ACTIVE_PROFILE };
}

/**
 * Builds the tone-instruction block to inject into the AI reply system
 * prompt. Returns null (meaning: stay generic) until there's enough real
 * signal — an untrained "personalization" is worse than none, since it
 * would just be imitating noise.
 */
export async function buildVoiceInstruction(workspaceId: string): Promise<string | null> {
  const examples = await getVoiceExamples(workspaceId);
  if (examples.length < MIN_EXAMPLES_FOR_ACTIVE_PROFILE) return null;

  const exampleBlock = examples.map((e, i) => `${i + 1}. "${e}"`).join("\n");
  return `The business owner has personally written and sent the following real replies to leads in the past. Study their tone, greeting style, formality, sentence length, and sign-off habits, and write your reply so it sounds like it came from this same person — not a generic assistant.\n\nReal examples of how the owner writes:\n${exampleBlock}`;
}
