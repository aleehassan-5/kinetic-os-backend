import { Router } from "express";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import { overviewHandler, invoicesHandler, checkoutHandler, portalHandler, cancelHandler, adminActivateHandler } from "./billing.controller";

const router = Router();

// Founder-only manual activation — deliberately mounted BEFORE requireAuth
// below, since this isn't a workspace-member action (no logged-in workspace
// user should ever be able to activate their own plan for free). Auth here
// is the constant-time secret check inside the handler itself.
const adminActivateLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
router.post("/admin/activate", adminActivateLimiter, asyncHandler(adminActivateHandler));

router.use(requireAuth);

router.get("/overview", asyncHandler(overviewHandler));
router.get("/invoices", asyncHandler(invoicesHandler));
router.post("/checkout", requireRole("OWNER", "ADMIN"), asyncHandler(checkoutHandler));
router.get("/portal", requireRole("OWNER", "ADMIN"), asyncHandler(portalHandler));
router.post("/cancel", requireRole("OWNER", "ADMIN"), asyncHandler(cancelHandler));

export default router;
