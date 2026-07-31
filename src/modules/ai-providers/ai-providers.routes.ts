import { Router } from "express";
import rateLimit from "express-rate-limit";
import type { Request } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import {
  listAiProvidersHandler,
  connectAiProviderHandler,
  testAiProviderHandler,
  disconnectAiProviderHandler,
} from "./ai-providers.controller";

const testLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.auth?.workspaceId ?? req.ip ?? "unknown",
});

const router = Router();
router.use(requireAuth);

router.get("/", asyncHandler(listAiProvidersHandler));
router.post("/test", requireRole("OWNER", "ADMIN"), testLimiter, asyncHandler(testAiProviderHandler));
router.post("/", requireRole("OWNER", "ADMIN"), asyncHandler(connectAiProviderHandler));
router.delete("/:provider", requireRole("OWNER", "ADMIN"), asyncHandler(disconnectAiProviderHandler));

export default router;
