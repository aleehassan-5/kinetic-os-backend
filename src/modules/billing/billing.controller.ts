import { z } from "zod";
import type { Request, Response } from "express";
import { prisma } from "@/lib/prisma";
import * as billingService from "./billing.service";

export const checkoutSchema = z.object({
  planId: z.enum(["starter", "growth", "scale"]),
});

export async function overviewHandler(req: Request, res: Response) {
  const result = await billingService.getBillingOverview(req.auth!.workspaceId);
  res.status(200).json(result);
}

export async function invoicesHandler(req: Request, res: Response) {
  const invoices = await billingService.listInvoices(req.auth!.workspaceId);
  res.status(200).json({ invoices });
}

export async function checkoutHandler(req: Request, res: Response) {
  const { planId } = checkoutSchema.parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
  const result = await billingService.startCheckout(req.auth!.workspaceId, planId, user.email, user.name);
  res.status(200).json(result);
}

export async function portalHandler(req: Request, res: Response) {
  const result = await billingService.getCustomerPortalUrl(req.auth!.workspaceId);
  res.status(200).json(result);
}

export async function cancelHandler(req: Request, res: Response) {
  await billingService.cancelWorkspaceSubscription(req.auth!.workspaceId);
  res.status(204).send();
}
