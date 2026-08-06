import { Router } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth } from "@/middleware/auth";
import { listLeadsHandler, getLeadHandler, replyHandler, updateLeadHandler, scheduleMeetingHandler, logCallHandler } from "./leads.controller";

const router = Router();
router.use(requireAuth);

router.get("/", asyncHandler(listLeadsHandler));
router.get("/:leadId", asyncHandler(getLeadHandler));
router.patch("/:leadId", asyncHandler(updateLeadHandler));
router.post("/:leadId/reply", asyncHandler(replyHandler));
router.post("/:leadId/meetings", asyncHandler(scheduleMeetingHandler));
router.post("/:leadId/log-call", asyncHandler(logCallHandler));

export default router;
