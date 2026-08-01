import { env } from "@/config/env";

export interface PlanLimits {
  leads: number;
  aiMessages: number;
  workflowRuns: number;
  teamMembers: number;
}

export interface PlanConfig {
  id: string;
  name: string;
  variantId: string;
  /**
   * Full rupees, not paisa. This is a REFERENCE point for the sales
   * conversation, not a fixed price — at beachhead stage every customer is
   * negotiated individually on WhatsApp, and the amount actually charged
   * (activateSubscriptionManually's amountPKR) can be anything the founder
   * agrees to. Automated card checkout (BILLING_MODE=lemonsqueezy) is the
   * only mode where this number is charged as-is.
   */
  pricePKR: number;
  priceLabel: string;
  /** One line comparing the price against hiring, shown right on the pricing card. */
  pitchLine: string;
  limits: PlanLimits;
}

/**
 * These tiers exist to differentiate usage limits (leads/messages/seats),
 * not to lock in a price. At beachhead stage, pricing is negotiated per
 * customer over WhatsApp — pricePKR below is a starting reference for that
 * conversation, anchored against a PKR 60,000/mo intake staffer or a PKR
 * 120,000/mo agency retainer (see the Moiz case study), not a bill.
 */
export const PLANS: PlanConfig[] = [
  {
    id: "starter",
    name: "Starter",
    variantId: env.LEMONSQUEEZY_VARIANT_STARTER,
    pricePKR: 9900,
    priceLabel: "From PKR 9,900/mo",
    pitchLine: "Less than a sixth of a PKR 60,000/mo intake staffer",
    limits: { leads: 500, aiMessages: 2000, workflowRuns: 1000, teamMembers: 2 },
  },
  {
    id: "growth",
    name: "Growth",
    variantId: env.LEMONSQUEEZY_VARIANT_GROWTH,
    pricePKR: 24900,
    priceLabel: "From PKR 24,900/mo",
    pitchLine: "Under half the cost of one intake staffer — covers your whole team",
    limits: { leads: 3000, aiMessages: 15000, workflowRuns: 10000, teamMembers: 8 },
  },
  {
    id: "scale",
    name: "Scale",
    variantId: env.LEMONSQUEEZY_VARIANT_SCALE,
    pricePKR: 54900,
    priceLabel: "From PKR 54,900/mo",
    pitchLine: "Still under half a PKR 120,000/mo agency retainer",
    limits: { leads: 20000, aiMessages: 100000, workflowRuns: 100000, teamMembers: 25 },
  },
];

export function getPlanById(planId: string): PlanConfig {
  return PLANS.find((p) => p.id === planId) ?? PLANS[0];
}

export function getPlanByVariantId(variantId: string): PlanConfig | undefined {
  return PLANS.find((p) => p.variantId === variantId);
}
