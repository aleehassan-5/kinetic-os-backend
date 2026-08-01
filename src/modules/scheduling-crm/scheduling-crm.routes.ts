import { Router } from "express";
import rateLimit from "express-rate-limit";
import type { Request } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import {
  listSchedulingCrmHandler,
  connectSchedulingCrmHandler,
  testSchedulingCrmHandler,
  disconnectSchedulingCrmHandler,
} from "./scheduling-crm.controller";

const testLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.auth?.workspaceId ?? req.ip ?? "unknown",
});

const router = Router();
router.use(requireAuth);

router.get("/", asyncHandler(listSchedulingCrmHandler));
router.post("/test", requireRole("OWNER", "ADMIN"), testLimiter, asyncHandler(testSchedulingCrmHandler));
router.post("/", requireRole("OWNER", "ADMIN"), asyncHandler(connectSchedulingCrmHandler));
router.delete("/:type", requireRole("OWNER", "ADMIN"), asyncHandler(disconnectSchedulingCrmHandler));

export default router;
