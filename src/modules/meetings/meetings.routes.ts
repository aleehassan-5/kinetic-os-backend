import { Router } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth } from "@/middleware/auth";
import { listHandler } from "./meetings.controller";

const router = Router();
router.use(requireAuth);

router.get("/", asyncHandler(listHandler));

export default router;
