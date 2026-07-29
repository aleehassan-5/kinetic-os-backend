import { Router } from "express";
import rateLimit from "express-rate-limit";
import type { Request } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import {
  listConnectionsHandler,
  connectChannelHandler,
  disconnectChannelHandler,
  testConnectionHandler,
} from "./channel-connections.controller";

const testLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.auth?.workspaceId ?? req.ip ?? "unknown",
});

const router = Router();
router.use(requireAuth);

router.get("/", asyncHandler(listConnectionsHandler));
router.post("/test", requireRole("OWNER", "ADMIN"), testLimiter, asyncHandler(testConnectionHandler));
router.post("/", requireRole("OWNER", "ADMIN"), asyncHandler(connectChannelHandler));
router.delete("/:channel", requireRole("OWNER", "ADMIN"), asyncHandler(disconnectChannelHandler));

export default router;
