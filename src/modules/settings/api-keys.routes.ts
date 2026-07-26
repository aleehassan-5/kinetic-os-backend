import { Router } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import { listHandler, createHandler, revokeHandler } from "./api-keys.controller";

const router = Router();
router.use(requireAuth);

router.get("/", asyncHandler(listHandler));
router.post("/", requireRole("OWNER", "ADMIN"), asyncHandler(createHandler));
router.delete("/:keyId", requireRole("OWNER", "ADMIN"), asyncHandler(revokeHandler));

export default router;
