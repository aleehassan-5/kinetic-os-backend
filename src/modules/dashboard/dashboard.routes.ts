import { Router } from "express";
import type { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth } from "@/middleware/auth";
import { getSummaryHandler } from "./dashboard.controller";
import { generateCheckin } from "./checkin.service";

const checkinLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.auth?.workspaceId ?? req.ip ?? "unknown",
});

const router = Router();
router.use(requireAuth);

router.get("/summary", asyncHandler(getSummaryHandler));
router.get(
  "/checkin",
  checkinLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const result = await generateCheckin(req.auth!.workspaceId);
    res.status(200).json(result);
  })
);

export default router;
