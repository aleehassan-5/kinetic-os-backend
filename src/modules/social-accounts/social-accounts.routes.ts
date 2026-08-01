import { Router } from "express";
import rateLimit from "express-rate-limit";
import type { Request } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import {
  listSocialAccountsHandler,
  connectSocialAccountHandler,
  testSocialAccountHandler,
  disconnectSocialAccountHandler,
  setAutoReplyHandler,
} from "./social-accounts.controller";

const testLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.auth?.workspaceId ?? req.ip ?? "unknown",
});

const router = Router();
router.use(requireAuth);

router.get("/", asyncHandler(listSocialAccountsHandler));
router.post("/test", requireRole("OWNER", "ADMIN"), testLimiter, asyncHandler(testSocialAccountHandler));
router.post("/", requireRole("OWNER", "ADMIN"), asyncHandler(connectSocialAccountHandler));
router.patch("/:platform/auto-reply", requireRole("OWNER", "ADMIN"), asyncHandler(setAutoReplyHandler));
router.delete("/:platform", requireRole("OWNER", "ADMIN"), asyncHandler(disconnectSocialAccountHandler));

export default router;
