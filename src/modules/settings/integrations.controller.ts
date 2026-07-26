import type { Request, Response } from "express";
import { prisma } from "@/lib/prisma";

export async function listHandler(req: Request, res: Response) {
  const integrations = await prisma.integration.findMany({
    where: { workspaceId: req.auth!.workspaceId },
    select: { id: true, type: true, status: true, detail: true, updatedAt: true },
    orderBy: { type: "asc" },
  });
  res.status(200).json({ integrations });
}
