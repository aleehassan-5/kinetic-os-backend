import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import * as workspaceService from "./workspace.service";

const updateWorkspaceSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  industry: z.string().min(1).max(60).optional(),
  timezone: z.string().min(1).max(60).optional(),
});

async function leaveHandler(req: Request, res: Response) {
  await workspaceService.leaveWorkspace(req.auth!.workspaceId, req.auth!.userId);
  res.status(204).send();
}

async function deleteHandler(req: Request, res: Response) {
  await workspaceService.deleteWorkspace(req.auth!.workspaceId, req.auth!.userId);
  res.status(204).send();
}

async function updateHandler(req: Request, res: Response) {
  const input = updateWorkspaceSchema.parse(req.body);
  const workspace = await workspaceService.updateWorkspace(req.auth!.workspaceId, req.auth!.userId, input);
  res.status(200).json(workspace);
}

const router = Router();
router.use(requireAuth);

router.patch("/", asyncHandler(updateHandler));
router.post("/leave", asyncHandler(leaveHandler));
router.delete("/", requireRole("OWNER"), asyncHandler(deleteHandler));

export default router;
