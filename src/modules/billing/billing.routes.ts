import { Router } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import { overviewHandler, invoicesHandler, checkoutHandler, portalHandler, cancelHandler } from "./billing.controller";

const router = Router();
router.use(requireAuth);

router.get("/overview", asyncHandler(overviewHandler));
router.get("/invoices", asyncHandler(invoicesHandler));
router.post("/checkout", requireRole("OWNER", "ADMIN"), asyncHandler(checkoutHandler));
router.get("/portal", requireRole("OWNER", "ADMIN"), asyncHandler(portalHandler));
router.post("/cancel", requireRole("OWNER", "ADMIN"), asyncHandler(cancelHandler));

export default router;
