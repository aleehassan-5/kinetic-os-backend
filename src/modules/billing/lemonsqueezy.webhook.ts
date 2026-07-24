import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { env } from "@/config/env";
import { createNotification } from "@/modules/notifications/notifications.service";
import { getPlanByVariantId } from "./plans";

export function verifyLemonSqueezySignature(rawBody: string, signatureHeader: string | string[] | undefined): boolean {
  if (!env.LEMONSQUEEZY_WEBHOOK_SECRET) return true; // dev mode without a configured secret
  if (typeof signatureHeader !== "string") return false;

  const expected = createHmac("sha256", env.LEMONSQUEEZY_WEBHOOK_SECRET).update(rawBody).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(signatureHeader, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

// Trimmed to the fields we actually read; Lemon Squeezy sends the full
// resource matching their REST API shape for whichever object changed.
interface LemonSqueezyWebhookBody {
  meta: {
    event_name: string;
    custom_data?: { workspace_id?: string };
  };
  data: {
    id: string;
    attributes: Record<string, unknown>;
  };
}

export async function handleLemonSqueezyEvent(body: LemonSqueezyWebhookBody) {
  const eventName = body.meta.event_name;
  const workspaceId = body.meta.custom_data?.workspace_id;

  logger.info({ eventName, workspaceId }, "[lemonsqueezy] webhook received");

  switch (eventName) {
    case "subscription_created":
    case "subscription_updated":
    case "subscription_resumed":
    case "subscription_unpaused":
      return upsertSubscription(body, workspaceId);

    case "subscription_cancelled":
    case "subscription_expired":
    case "subscription_paused":
      return upsertSubscription(body, workspaceId);

    case "subscription_payment_success":
      return recordInvoice(body, workspaceId, "PAID");

    case "subscription_payment_failed":
      return recordInvoice(body, workspaceId, "FAILED");

    case "order_created":
      return recordInvoice(body, workspaceId, "PAID");

    default:
      logger.info({ eventName }, "[lemonsqueezy] unhandled event type — ignoring");
  }
}

async function upsertSubscription(body: LemonSqueezyWebhookBody, workspaceId?: string) {
  if (!workspaceId) {
    logger.warn({ id: body.data.id }, "[lemonsqueezy] subscription event missing workspace_id in custom_data");
    return;
  }

  const a = body.data.attributes as {
    status: string;
    variant_id: number;
    renews_at: string | null;
    ends_at: string | null;
    trial_ends_at: string | null;
    card_brand: string | null;
    card_last_four: string | null;
    order_id: number;
    urls?: { update_payment_method?: string; customer_portal?: string };
  };

  const statusMap: Record<string, string> = {
    on_trial: "ON_TRIAL",
    active: "ACTIVE",
    paused: "PAUSED",
    past_due: "PAST_DUE",
    unpaid: "UNPAID",
    cancelled: "CANCELLED",
    expired: "EXPIRED",
  };

  const plan = getPlanByVariantId(String(a.variant_id));

  await prisma.subscription.upsert({
    where: { workspaceId },
    create: {
      workspaceId,
      lemonSqueezyId: body.data.id,
      lemonSqueezyOrderId: String(a.order_id),
      variantId: String(a.variant_id),
      planName: plan?.name ?? "Unknown plan",
      status: (statusMap[a.status] as never) ?? "ACTIVE",
      renewsAt: a.renews_at ? new Date(a.renews_at) : null,
      endsAt: a.ends_at ? new Date(a.ends_at) : null,
      trialEndsAt: a.trial_ends_at ? new Date(a.trial_ends_at) : null,
      cardBrand: a.card_brand,
      cardLastFour: a.card_last_four,
      updatePaymentMethodUrl: a.urls?.update_payment_method,
      customerPortalUrl: a.urls?.customer_portal,
    },
    update: {
      status: (statusMap[a.status] as never) ?? "ACTIVE",
      renewsAt: a.renews_at ? new Date(a.renews_at) : null,
      endsAt: a.ends_at ? new Date(a.ends_at) : null,
      cardBrand: a.card_brand,
      cardLastFour: a.card_last_four,
      updatePaymentMethodUrl: a.urls?.update_payment_method,
      customerPortalUrl: a.urls?.customer_portal,
    },
  });

  if (plan) {
    await prisma.workspace.update({ where: { id: workspaceId }, data: { planId: plan.id } });
  }

  if (a.status === "past_due" || a.status === "unpaid") {
    await createNotification(workspaceId, {
      type: "BILLING",
      title: "Payment issue on your subscription",
      description: "Your last payment didn't go through. Update your payment method to avoid service interruption.",
    });
  }
}

async function recordInvoice(body: LemonSqueezyWebhookBody, workspaceId: string | undefined, status: "PAID" | "FAILED") {
  if (!workspaceId) {
    logger.warn({ id: body.data.id }, "[lemonsqueezy] order event missing workspace_id in custom_data");
    return;
  }

  const a = body.data.attributes as {
    total: number;
    currency: string;
    created_at: string;
    identifier?: string;
    urls?: { invoice_url?: string };
    order_id?: number;
  };

  const orderId = String(a.order_id ?? body.data.id);

  await prisma.invoice.upsert({
    where: { lemonSqueezyOrderId: orderId },
    create: {
      workspaceId,
      lemonSqueezyOrderId: orderId,
      amountCents: a.total,
      currency: a.currency,
      status,
      invoiceUrl: a.urls?.invoice_url,
      billingReason: body.meta.event_name,
      issuedAt: new Date(a.created_at),
    },
    update: { status, invoiceUrl: a.urls?.invoice_url },
  });

  if (status === "FAILED") {
    await createNotification(workspaceId, {
      type: "BILLING",
      title: "Invoice payment failed",
      description: "We couldn't process your latest invoice. Please check your payment method in Settings → Billing.",
    });
  }
}
