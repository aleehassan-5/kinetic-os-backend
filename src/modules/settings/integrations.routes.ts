import { Router } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth } from "@/middleware/auth";
import { listHandler } from "./integrations.controller";

const router = Router();
router.use(requireAuth);

// Read-only for now — these rows are seeded NOT_CONNECTED at signup (see
// auth.service.ts). There's no real connect/disconnect OAuth flow wired up
// yet for WhatsApp/Telegram/etc, so we don't expose a way to flip status
// here rather than fake one.
router.get("/", asyncHandler(listHandler));

export default router;
