import { Router } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth } from "@/middleware/auth";
import { getSummaryHandler } from "./dashboard.controller";

const router = Router();
router.use(requireAuth);

router.get("/summary", asyncHandler(getSummaryHandler));

export default router;
