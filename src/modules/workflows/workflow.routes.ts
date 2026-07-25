import { Router } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth } from "@/middleware/auth";
import {
  listHandler,
  getHandler,
  createHandler,
  updateHandler,
  deleteHandler,
  listRunsHandler,
  testRunHandler,
} from "./workflow.controller";

const router = Router();
router.use(requireAuth);

router.get("/", asyncHandler(listHandler));
router.post("/", asyncHandler(createHandler));
router.get("/:workflowId", asyncHandler(getHandler));
router.patch("/:workflowId", asyncHandler(updateHandler));
router.delete("/:workflowId", asyncHandler(deleteHandler));
router.get("/:workflowId/runs", asyncHandler(listRunsHandler));
router.post("/:workflowId/test-run", asyncHandler(testRunHandler));

export default router;
