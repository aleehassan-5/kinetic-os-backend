import { z } from "zod";
import { timingSafeEqual } from "crypto";
import type { Request, Response } from "express";
import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { UnauthorizedError, AppError } from "@/lib/errors";
import * as billingService from "./billing.service";

export const checkoutSchema = z.object({
  planId: z.enum(["starter", "growth", "scale"]),
});

const adminActivateSchema = z.object({
  workspaceId: z.string().min(1),
  planId: z.enum(["starter", "growth", "scale"]),
  // Whatever was actually agreed with this customer — omit to fall back to
  // the plan's reference price in plans.ts.
  amountPKR: z.number().positive().optional(),
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

/**
 * Founder-only: confirms a manual bank/JazzCash/Easypaisa transfer and
 * activates the workspace's plan. Not tied to any workspace's membership —
 * gated purely by BILLING_ADMIN_SECRET (constant-time compared) since the
 * founder is acting across every customer's workspace, not as a member of
 * any single one.
 */
export async function adminActivateHandler(req: Request, res: Response) {
  if (!env.BILLING_ADMIN_SECRET) {
    throw new AppError("BILLING_ADMIN_SECRET is not configured — set it before using manual activation", 503);
  }

  const provided = Buffer.from(req.header("x-billing-admin-secret") ?? "");
  const expected = Buffer.from(env.BILLING_ADMIN_SECRET);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new UnauthorizedError("Invalid admin secret");
  }

  const { workspaceId, planId, amountPKR } = adminActivateSchema.parse(req.body);
  await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }); // 404s cleanly if the id is wrong
  const result = await billingService.activateSubscriptionManually(workspaceId, planId, amountPKR);
  res.status(200).json(result);
}
