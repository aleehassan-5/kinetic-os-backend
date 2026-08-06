import { Router } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth } from "@/middleware/auth";
import { globalSearchHandler } from "./search.controller";

const router = Router();
router.use(requireAuth);

router.get("/", asyncHandler(globalSearchHandler));

export default router;
