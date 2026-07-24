import { Router } from "express";
import type { Request, Response } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { logger } from "@/lib/logger";
import { verifyLemonSqueezySignature, handleLemonSqueezyEvent } from "./lemonsqueezy.webhook";

const router = Router();

router.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const rawBody = (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body);
    const signature = req.headers["x-signature"];

    if (!verifyLemonSqueezySignature(rawBody, signature)) {
      logger.warn("[lemonsqueezy] invalid webhook signature");
      return res.status(401).json({ error: "Invalid signature" });
    }

    await handleLemonSqueezyEvent(req.body);
    res.status(200).json({ received: true });
  })
);

export default router;
