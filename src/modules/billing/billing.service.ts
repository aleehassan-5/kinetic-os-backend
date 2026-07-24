import { prisma } from "@/lib/prisma";
import { NotFoundError, AppError } from "@/lib/errors";
import { getPlanById } from "./plans";
import * as lemonSqueezy from "./lemonsqueezy.client";

function startOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export async function getBillingOverview(workspaceId: string) {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    include: { subscription: true },
  });

  const plan = getPlanById(workspace.planId);
  const since = startOfMonth();

  const [leadsThisMonth, aiMessagesThisMonth, workflowRunsThisMonth, teamMembers] = await Promise.all([
    prisma.lead.count({ where: { workspaceId, createdAt: { gte: since } } }),
    prisma.message.count({
      where: { sender: "AI", createdAt: { gte: since }, conversation: { workspaceId } },
    }),
    prisma.workflowRun.count({ where: { createdAt: { gte: since }, workflow: { workspaceId } } }),
    prisma.membership.count({ where: { workspaceId, status: "ACTIVE" } }),
  ]);

  return {
    plan: { id: plan.id, name: plan.name, priceLabel: plan.priceLabel },
    subscription: workspace.subscription,
    usage: {
      leads: { used: leadsThisMonth, limit: plan.limits.leads },
      aiMessages: { used: aiMessagesThisMonth, limit: plan.limits.aiMessages },
      workflowRuns: { used: workflowRunsThisMonth, limit: plan.limits.workflowRuns },
      teamMembers: { used: teamMembers, limit: plan.limits.teamMembers },
    },
  };
}

export async function listInvoices(workspaceId: string) {
  return prisma.invoice.findMany({ where: { workspaceId }, orderBy: { issuedAt: "desc" } });
}

export async function startCheckout(workspaceId: string, planId: string, userEmail: string, userName?: string) {
  const plan = getPlanById(planId);
  if (!plan.variantId) {
    throw new AppError(`Plan "${planId}" has no Lemon Squeezy variant configured yet`, 503);
  }
  const url = await lemonSqueezy.createCheckout({ variantId: plan.variantId, workspaceId, email: userEmail, name: userName });
  return { checkoutUrl: url };
}

export async function getCustomerPortalUrl(workspaceId: string) {
  const subscription = await prisma.subscription.findUnique({ where: { workspaceId } });
  if (!subscription) throw new NotFoundError("No active subscription for this workspace");
  return { portalUrl: subscription.customerPortalUrl ?? subscription.updatePaymentMethodUrl };
}

export async function cancelWorkspaceSubscription(workspaceId: string) {
  const subscription = await prisma.subscription.findUnique({ where: { workspaceId } });
  if (!subscription) throw new NotFoundError("No active subscription for this workspace");

  await lemonSqueezy.cancelSubscription(subscription.lemonSqueezyId);
  await prisma.subscription.update({ where: { workspaceId }, data: { status: "CANCELLED" } });
}
