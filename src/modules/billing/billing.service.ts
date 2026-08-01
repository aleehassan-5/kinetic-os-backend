import { prisma } from "@/lib/prisma";
import { NotFoundError, AppError } from "@/lib/errors";
import { env } from "@/config/env";
import { getPlanById } from "./plans";
import * as lemonSqueezy from "./lemonsqueezy.client";

function startOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Subscriptions/invoices created by the manual "founder marks paid" flow use this id prefix instead of a real Lemon Squeezy id. */
const MANUAL_ID_PREFIX = "manual_";

function isManualSubscription(lemonSqueezyId: string): boolean {
  return lemonSqueezyId.startsWith(MANUAL_ID_PREFIX);
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
    plan: { id: plan.id, name: plan.name, priceLabel: plan.priceLabel, pricePKR: plan.pricePKR, pitchLine: plan.pitchLine },
    subscription: workspace.subscription,
    billingMode: env.BILLING_MODE,
    isManualSubscription: workspace.subscription ? isManualSubscription(workspace.subscription.lemonSqueezyId) : false,
    manualPayment:
      env.BILLING_MODE === "manual"
        ? {
            whatsappNumber: env.FOUNDER_WHATSAPP_NUMBER || null,
            bank: env.BANK_ACCOUNT_NUMBER
              ? { accountTitle: env.BANK_ACCOUNT_TITLE, accountNumber: env.BANK_ACCOUNT_NUMBER, bankName: env.BANK_NAME }
              : null,
            easypaisaNumber: env.EASYPAISA_NUMBER || null,
            jazzcashNumber: env.JAZZCASH_NUMBER || null,
          }
        : null,
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

export type StartCheckoutResult =
  | { mode: "lemonsqueezy"; checkoutUrl: string }
  | {
      mode: "manual";
      plan: { id: string; name: string; priceLabel: string; pricePKR: number };
      whatsappUrl: string | null;
      bank: { accountTitle: string; accountNumber: string; bankName: string } | null;
      easypaisaNumber: string | null;
      jazzcashNumber: string | null;
    };

export async function startCheckout(workspaceId: string, planId: string, userEmail: string, userName?: string): Promise<StartCheckoutResult> {
  const plan = getPlanById(planId);

  if (env.BILLING_MODE === "manual") {
    // No automated checkout yet — this is the intentional state for the
    // first handful of beachhead customers (see plans.ts / billing docs).
    // Point them at WhatsApp with bank/JazzCash/Easypaisa details; the
    // founder confirms the transfer manually and calls the admin/activate
    // endpoint below to flip the workspace to that plan.
    const message = encodeURIComponent(
      `Hi! I'd like to subscribe to the ${plan.name} plan (${plan.priceLabel}) on Kinetic OS.`
    );
    return {
      mode: "manual",
      plan: { id: plan.id, name: plan.name, priceLabel: plan.priceLabel, pricePKR: plan.pricePKR },
      whatsappUrl: env.FOUNDER_WHATSAPP_NUMBER ? `https://wa.me/${env.FOUNDER_WHATSAPP_NUMBER}?text=${message}` : null,
      bank: env.BANK_ACCOUNT_NUMBER
        ? { accountTitle: env.BANK_ACCOUNT_TITLE, accountNumber: env.BANK_ACCOUNT_NUMBER, bankName: env.BANK_NAME }
        : null,
      easypaisaNumber: env.EASYPAISA_NUMBER || null,
      jazzcashNumber: env.JAZZCASH_NUMBER || null,
    };
  }

  if (!plan.variantId) {
    throw new AppError(`Plan "${planId}" has no Lemon Squeezy variant configured yet`, 503);
  }
  const url = await lemonSqueezy.createCheckout({ variantId: plan.variantId, workspaceId, email: userEmail, name: userName });
  return { mode: "lemonsqueezy", checkoutUrl: url };
}

export async function getCustomerPortalUrl(workspaceId: string) {
  const subscription = await prisma.subscription.findUnique({ where: { workspaceId } });
  if (!subscription) throw new NotFoundError("No active subscription for this workspace");
  if (isManualSubscription(subscription.lemonSqueezyId)) {
    return { portalUrl: null }; // no self-serve portal in manual mode — frontend shows WhatsApp/bank details instead
  }
  return { portalUrl: subscription.customerPortalUrl ?? subscription.updatePaymentMethodUrl };
}

export async function cancelWorkspaceSubscription(workspaceId: string) {
  const subscription = await prisma.subscription.findUnique({ where: { workspaceId } });
  if (!subscription) throw new NotFoundError("No active subscription for this workspace");

  if (isManualSubscription(subscription.lemonSqueezyId)) {
    await prisma.subscription.update({ where: { workspaceId }, data: { status: "CANCELLED" } });
    return;
  }

  await lemonSqueezy.cancelSubscription(subscription.lemonSqueezyId);
  await prisma.subscription.update({ where: { workspaceId }, data: { status: "CANCELLED" } });
}

/**
 * Manual "founder marks paid" activation, for the beachhead-stage customers
 * paying via bank transfer / JazzCash / Easypaisa outside any automated
 * gateway. Not exposed to workspace members — gated by BILLING_ADMIN_SECRET,
 * meant to be called by the founder after confirming the transfer landed.
 */
export async function activateSubscriptionManually(workspaceId: string, planId: string) {
  const plan = getPlanById(planId);
  const now = new Date();
  const renewsAt = new Date(now);
  renewsAt.setDate(renewsAt.getDate() + 30);
  const manualId = `${MANUAL_ID_PREFIX}${workspaceId}_${now.getTime()}`;

  await prisma.$transaction([
    prisma.workspace.update({ where: { id: workspaceId }, data: { planId: plan.id } }),
    prisma.subscription.upsert({
      where: { workspaceId },
      update: {
        lemonSqueezyId: manualId,
        variantId: "manual",
        planName: plan.name,
        status: "ACTIVE",
        renewsAt,
        endsAt: null,
        cardBrand: null,
        cardLastFour: null,
        updatePaymentMethodUrl: null,
        customerPortalUrl: null,
      },
      create: {
        workspaceId,
        lemonSqueezyId: manualId,
        variantId: "manual",
        planName: plan.name,
        status: "ACTIVE",
        renewsAt,
      },
    }),
    prisma.invoice.create({
      data: {
        workspaceId,
        lemonSqueezyOrderId: manualId,
        amountCents: plan.pricePKR * 100,
        currency: "PKR",
        status: "PAID",
        billingReason: "Manual payment confirmed",
        issuedAt: now,
      },
    }),
  ]);

  return { activated: true, plan: plan.id, renewsAt };
}
