import { Router } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import {
  listConnectionsHandler,
  connectChannelHandler,
  disconnectChannelHandler,
} from "./channel-connections.controller";

const router = Router();
router.use(requireAuth);

router.get("/", asyncHandler(listConnectionsHandler));
router.post("/", requireRole("OWNER", "ADMIN"), asyncHandler(connectChannelHandler));
router.delete("/:channel", requireRole("OWNER", "ADMIN"), asyncHandler(disconnectChannelHandler));

export default router;
