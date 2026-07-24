/**
 * Rule-based intent scoring (0-100). Deterministic and free to run on every
 * inbound message. Swap the body of `scoreIntent` for an LLM call (e.g. ask
 * gpt-4o-mini to rate purchase intent 0-100 given the conversation) once
 * volume justifies the extra latency/cost — the function signature stays
 * the same either way.
 */

const HIGH_INTENT_KEYWORDS = [
  "price",
  "pricing",
  "cost",
  "buy",
  "purchase",
  "quote",
  "demo",
  "trial",
  "sign up",
  "subscribe",
  "book a call",
  "meeting",
  "invoice",
  "payment",
];

const MEDIUM_INTENT_KEYWORDS = ["interested", "how does", "how much", "features", "plan", "package", "available", "when can"];

const LOW_INTENT_KEYWORDS = ["hello", "hi", "hey", "just browsing", "thanks", "ok", "okay"];

export interface IntentScoreResult {
  score: number;
  matchedKeywords: string[];
}

export function scoreIntent(messageText: string, priorScore = 0): IntentScoreResult {
  const text = messageText.toLowerCase();
  let delta = 0;
  const matched: string[] = [];

  for (const kw of HIGH_INTENT_KEYWORDS) {
    if (text.includes(kw)) {
      delta += 18;
      matched.push(kw);
    }
  }
  for (const kw of MEDIUM_INTENT_KEYWORDS) {
    if (text.includes(kw)) {
      delta += 8;
      matched.push(kw);
    }
  }
  for (const kw of LOW_INTENT_KEYWORDS) {
    if (text.includes(kw)) {
      delta -= 3;
      matched.push(kw);
    }
  }

  // Longer, detail-rich messages tend to signal a more serious prospect.
  if (messageText.length > 140) delta += 5;

  // Questions ("?") often precede a buying decision.
  if (text.includes("?")) delta += 4;

  const score = Math.max(0, Math.min(100, priorScore + delta));
  return { score, matchedKeywords: matched };
}
