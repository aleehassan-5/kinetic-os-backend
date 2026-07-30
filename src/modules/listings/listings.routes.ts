import { Router } from "express";
import type { Request } from "express";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import {
  listListingsHandler,
  getListingHandler,
  createListingHandler,
  updateListingHandler,
  deleteListingHandler,
  contentPlanHandler,
} from "./listings.controller";

// Real LLM call + generates multiple posts (each with their own AI
// graphic/voiceover generation cost) per invocation — tighter limit than
// the general API.
const contentPlanLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.auth?.workspaceId ?? req.ip ?? "unknown",
});

const router = Router();
router.use(requireAuth);

router.get("/", asyncHandler(listListingsHandler));
router.get("/:listingId", asyncHandler(getListingHandler));
router.post("/", requireRole("OWNER", "ADMIN", "EDITOR"), asyncHandler(createListingHandler));
router.patch("/:listingId", requireRole("OWNER", "ADMIN", "EDITOR"), asyncHandler(updateListingHandler));
router.delete("/:listingId", requireRole("OWNER", "ADMIN"), asyncHandler(deleteListingHandler));
router.post(
  "/:listingId/content-plan",
  requireRole("OWNER", "ADMIN", "EDITOR"),
  contentPlanLimiter,
  asyncHandler(contentPlanHandler)
);

export default router;
