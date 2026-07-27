import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

const { prismaMock, createNotificationMock } = vi.hoisted(() => {
  const mock: any = {
    subscription: { upsert: vi.fn() },
    workspace: { update: vi.fn() },
    invoice: { upsert: vi.fn() },
    notification: { create: vi.fn() },
  };
  return { prismaMock: mock, createNotificationMock: vi.fn() };
});
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/modules/notifications/notifications.service", () => ({ createNotification: createNotificationMock }));
vi.mock("@/modules/billing/plans", () => ({
  getPlanByVariantId: (variantId: string) =>
    variantId === "1001" ? { id: "growth", name: "Growth" } : undefined,
}));

import { verifyLemonSqueezySignature, handleLemonSqueezyEvent } from "@/modules/billing/lemonsqueezy.webhook";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("billing — webhook signature verification", () => {
  const secret = "test-lemonsqueezy-secret"; // matches .env.test's LEMONSQUEEZY_WEBHOOK_SECRET

  it("accepts a signature that genuinely matches the secret (real HMAC, no mocking)", () => {
    const body = JSON.stringify({ meta: { event_name: "order_created" } });
    const validSignature = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyLemonSqueezySignature(body, validSignature)).toBe(true);
  });

  it("rejects a tampered payload even though a signature is present", () => {
    const realBody = JSON.stringify({ amount: 100 });
    const tamperedBody = JSON.stringify({ amount: 100000 });
    const signatureForRealBody = createHmac("sha256", secret).update(realBody).digest("hex");

    expect(verifyLemonSqueezySignature(tamperedBody, signatureForRealBody)).toBe(false);
  });

  it("rejects a signature signed with the wrong secret", () => {
    const body = JSON.stringify({ hello: "world" });
    const wrongSignature = createHmac("sha256", "not-the-real-secret").update(body).digest("hex");
    expect(verifyLemonSqueezySignature(body, wrongSignature)).toBe(false);
  });

  it("rejects when no signature header is present at all", () => {
    expect(verifyLemonSqueezySignature("{}", undefined)).toBe(false);
  });

  it("rejects a malformed (non-hex) signature instead of throwing", () => {
    expect(verifyLemonSqueezySignature("{}", "not-valid-hex!!")).toBe(false);
  });
});

describe("billing — subscription webhook events", () => {
  it("upserts an ACTIVE subscription and updates the workspace's plan on subscription_created", async () => {
    prismaMock.subscription.upsert.mockResolvedValue({});
    prismaMock.workspace.update.mockResolvedValue({});

    await handleLemonSqueezyEvent({
      meta: { event_name: "subscription_created", custom_data: { workspace_id: "ws1" } },
      data: {
        id: "sub_1",
        attributes: {
          status: "active",
          variant_id: 1001,
          renews_at: "2026-08-01T00:00:00Z",
          ends_at: null,
          trial_ends_at: null,
          card_brand: "visa",
          card_last_four: "4242",
          order_id: 555,
        },
      },
    });

    expect(prismaMock.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: "ws1" },
        create: expect.objectContaining({ status: "ACTIVE", planName: "Growth" }),
      })
    );
    // Real plan match must actually update the workspace's plan, not just log it.
    expect(prismaMock.workspace.update).toHaveBeenCalledWith({ where: { id: "ws1" }, data: { planId: "growth" } });
  });

  it("notifies the workspace when a subscription goes past_due", async () => {
    prismaMock.subscription.upsert.mockResolvedValue({});

    await handleLemonSqueezyEvent({
      meta: { event_name: "subscription_updated", custom_data: { workspace_id: "ws1" } },
      data: {
        id: "sub_1",
        attributes: { status: "past_due", variant_id: 1001, renews_at: null, ends_at: null, trial_ends_at: null, card_brand: null, card_last_four: null, order_id: 555 },
      },
    });

    expect(createNotificationMock).toHaveBeenCalledWith(
      "ws1",
      expect.objectContaining({ type: "BILLING", title: expect.stringMatching(/payment issue/i) })
    );
  });

  it("does nothing destructive when workspace_id is missing from custom_data (malformed/misconfigured webhook)", async () => {
    await handleLemonSqueezyEvent({
      meta: { event_name: "subscription_created" }, // no custom_data at all
      data: { id: "sub_1", attributes: { status: "active", variant_id: 1001, order_id: 1 } },
    });

    expect(prismaMock.subscription.upsert).not.toHaveBeenCalled();
  });
});

describe("billing — invoice/payment events", () => {
  it("records a FAILED invoice and notifies the workspace on subscription_payment_failed", async () => {
    prismaMock.invoice.upsert.mockResolvedValue({});

    await handleLemonSqueezyEvent({
      meta: { event_name: "subscription_payment_failed", custom_data: { workspace_id: "ws1" } },
      data: {
        id: "inv_1",
        attributes: { total: 5000, currency: "USD", created_at: "2026-07-01T00:00:00Z", order_id: 999 },
      },
    });

    expect(prismaMock.invoice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ status: "FAILED", amountCents: 5000 }) })
    );
    expect(createNotificationMock).toHaveBeenCalledWith(
      "ws1",
      expect.objectContaining({ title: expect.stringMatching(/invoice payment failed/i) })
    );
  });

  it("ignores event types it doesn't recognize instead of throwing", async () => {
    await expect(
      handleLemonSqueezyEvent({
        meta: { event_name: "some_future_event_type", custom_data: { workspace_id: "ws1" } },
        data: { id: "x", attributes: {} },
      })
    ).resolves.not.toThrow();
  });
});
