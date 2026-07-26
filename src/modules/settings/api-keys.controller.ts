import type { Request, Response } from "express";
import { z } from "zod";
import * as apiKeysService from "./api-keys.service";

const createSchema = z.object({
  name: z.string().min(1).max(60),
  scope: z.enum(["FULL", "READ_ONLY"]).default("READ_ONLY"),
});

export async function listHandler(req: Request, res: Response) {
  const keys = await apiKeysService.listApiKeys(req.auth!.workspaceId);
  res.status(200).json({ apiKeys: keys });
}

export async function createHandler(req: Request, res: Response) {
  const { name, scope } = createSchema.parse(req.body);
  const key = await apiKeysService.createApiKey(req.auth!.workspaceId, name, scope);
  res.status(201).json(key);
}

export async function revokeHandler(req: Request, res: Response) {
  await apiKeysService.revokeApiKey(req.auth!.workspaceId, req.params.keyId);
  res.status(204).send();
}
