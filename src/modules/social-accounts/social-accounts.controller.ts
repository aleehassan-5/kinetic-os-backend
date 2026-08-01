import type { Request, Response } from "express";
import type { SocialPlatformId } from "./social-accounts.schema";
import { connectSocialAccountSchema } from "./social-accounts.schema";
import * as socialAccountsService from "./social-accounts.service";

export async function listSocialAccountsHandler(req: Request, res: Response) {
  const accounts = await socialAccountsService.listSocialAccounts(req.auth!.workspaceId);
  res.status(200).json({ accounts });
}

export async function connectSocialAccountHandler(req: Request, res: Response) {
  const input = connectSocialAccountSchema.parse(req.body);
  const result = await socialAccountsService.connectSocialAccount(req.auth!.workspaceId, input);
  res.status(200).json(result);
}

export async function testSocialAccountHandler(req: Request, res: Response) {
  const input = connectSocialAccountSchema.parse(req.body);
  const result = await socialAccountsService.testSocialAccount(input);
  res.status(200).json(result);
}

export async function disconnectSocialAccountHandler(req: Request, res: Response) {
  const result = await socialAccountsService.disconnectSocialAccount(req.auth!.workspaceId, req.params.platform as SocialPlatformId);
  res.status(200).json(result);
}

export async function setAutoReplyHandler(req: Request, res: Response) {
  const enabled = Boolean(req.body.enabled);
  const result = await socialAccountsService.setAutoReply(req.auth!.workspaceId, req.params.platform as SocialPlatformId, enabled);
  res.status(200).json(result);
}
