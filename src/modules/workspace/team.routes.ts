import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireRole } from "@/middleware/auth";
import * as teamService from "./team.service";

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "EDITOR", "VIEWER"]).default("EDITOR"),
});

const updateRoleSchema = z.object({ role: z.enum(["OWNER", "ADMIN", "EDITOR", "VIEWER"]) });

async function listHandler(req: Request, res: Response) {
  const members = await teamService.listMembers(req.auth!.workspaceId);
  res.status(200).json({ members });
}

async function inviteHandler(req: Request, res: Response) {
  const { email, role } = inviteSchema.parse(req.body);
  const membership = await teamService.inviteMember(req.auth!.workspaceId, email, role, req.auth!.userId);
  res.status(201).json(membership);
}

async function updateRoleHandler(req: Request, res: Response) {
  const { role } = updateRoleSchema.parse(req.body);
  const membership = await teamService.updateMemberRole(req.auth!.workspaceId, req.params.membershipId, role);
  res.status(200).json(membership);
}

async function removeHandler(req: Request, res: Response) {
  await teamService.removeMember(req.auth!.workspaceId, req.params.membershipId);
  res.status(204).send();
}

const router = Router();
router.use(requireAuth);

router.get("/", asyncHandler(listHandler));
router.post("/invite", requireRole("OWNER", "ADMIN"), asyncHandler(inviteHandler));
router.patch("/:membershipId/role", requireRole("OWNER", "ADMIN"), asyncHandler(updateRoleHandler));
router.delete("/:membershipId", requireRole("OWNER", "ADMIN"), asyncHandler(removeHandler));

export default router;
