import type { Request, Response } from "express";
import { accountStatusFilterSchema, rejectAccountSchema } from "./admin.schema";
import * as adminService from "./admin.service";

export async function listAccountsHandler(req: Request, res: Response) {
  const { status } = accountStatusFilterSchema.parse(req.query);
  const accounts = await adminService.listAccounts(status);
  res.status(200).json({ accounts });
}

export async function getAccountDetailHandler(req: Request, res: Response) {
  const account = await adminService.getAccountDetail(req.params.id);
  res.status(200).json(account);
}

export async function approveAccountHandler(req: Request, res: Response) {
  const result = await adminService.approveAccount(req.params.id, req.auth!.userId);
  res.status(200).json(result);
}

export async function rejectAccountHandler(req: Request, res: Response) {
  const input = rejectAccountSchema.parse(req.body);
  const result = await adminService.rejectAccount(req.params.id, req.auth!.userId, input);
  res.status(200).json(result);
}

export async function suspendAccountHandler(req: Request, res: Response) {
  const result = await adminService.suspendAccount(req.params.id);
  res.status(200).json(result);
}

export async function reactivateAccountHandler(req: Request, res: Response) {
  const result = await adminService.reactivateAccount(req.params.id);
  res.status(200).json(result);
}

export async function deleteAccountHandler(req: Request, res: Response) {
  const result = await adminService.deleteAccount(req.params.id);
  res.status(200).json(result);
}
