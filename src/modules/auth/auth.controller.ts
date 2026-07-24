import type { Request, Response } from "express";
import { registerSchema, loginSchema, refreshSchema } from "./auth.schema";
import * as authService from "./auth.service";

export async function registerHandler(req: Request, res: Response) {
  const input = registerSchema.parse(req.body);
  const result = await authService.register(input);
  res.status(201).json(result);
}

export async function loginHandler(req: Request, res: Response) {
  const input = loginSchema.parse(req.body);
  const result = await authService.login(input);
  res.status(200).json(result);
}

export async function refreshHandler(req: Request, res: Response) {
  const { refreshToken } = refreshSchema.parse(req.body);
  const result = await authService.refresh(refreshToken);
  res.status(200).json(result);
}

export async function logoutHandler(req: Request, res: Response) {
  const { refreshToken } = refreshSchema.parse(req.body);
  await authService.logout(refreshToken);
  res.status(204).send();
}

export async function meHandler(req: Request, res: Response) {
  const result = await authService.me(req.auth!.userId, req.auth!.workspaceId);
  res.status(200).json(result);
}
