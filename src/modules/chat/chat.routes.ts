import { Router } from "express";
import type { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth } from "@/middleware/auth";
import { answerWithKnowledgeBase } from "./chat.service";

// Each request here can trigger a real (billed) OpenAI call, so it needs a
// tighter cap than the general API — this keeps a single workspace from
// running up the AI bill or being used to hammer the LLM provider.
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.auth?.workspaceId ?? req.ip ?? "unknown",
});

const chatRequestSchema = z.object({
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1) }))
    .min(1)
    .max(40),
});

async function chatHandler(req: Request, res: Response) {
  const { history } = chatRequestSchema.parse(req.body);
  const result = await answerWithKnowledgeBase(req.auth!.workspaceId, history);
  res.status(200).json(result);
}

const router = Router();
router.use(requireAuth);
router.post("/", chatLimiter, asyncHandler(chatHandler));

export default router;
