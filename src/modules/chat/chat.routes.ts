import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth } from "@/middleware/auth";
import { answerWithKnowledgeBase } from "./chat.service";

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
router.post("/", asyncHandler(chatHandler));

export default router;
