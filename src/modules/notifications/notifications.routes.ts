import { Router } from "express";
import type { Request, Response } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth } from "@/middleware/auth";
import * as notificationsService from "./notifications.service";

async function listHandler(req: Request, res: Response) {
  const unreadOnly = req.query.tab === "unread";
  const notifications = await notificationsService.listNotifications(req.auth!.workspaceId, unreadOnly);
  res.status(200).json({ notifications });
}

async function markReadHandler(req: Request, res: Response) {
  await notificationsService.markRead(req.auth!.workspaceId, req.params.id);
  res.status(204).send();
}

async function markAllReadHandler(req: Request, res: Response) {
  await notificationsService.markAllRead(req.auth!.workspaceId);
  res.status(204).send();
}

const router = Router();
router.use(requireAuth);
router.get("/", asyncHandler(listHandler));
router.post("/read-all", asyncHandler(markAllReadHandler));
router.post("/:id/read", asyncHandler(markReadHandler));

export default router;
