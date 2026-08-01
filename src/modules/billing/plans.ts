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
  /** Full rupees, not paisa — the number a Pakistani small business owner reads directly. */
  pricePKR: number;
  priceLabel: string;
  /** One line comparing the price against hiring, shown right on the pricing card. */
  pitchLine: string;
  limits: PlanLimits;
}

/**
 * Priced against what a Pakistani small business owner is actually comparing
 * this to: a PKR 60,000/mo intake staffer, or a PKR 120,000/mo agency
 * retainer (see the Moiz case study). Every tier should read as an obvious
 * win against those two numbers, not as an abstract USD SaaS price.
 */
export const PLANS: PlanConfig[] = [
  {
    id: "starter",
    name: "Starter",
    variantId: env.LEMONSQUEEZY_VARIANT_STARTER,
    pricePKR: 9900,
    priceLabel: "PKR 9,900/mo",
    pitchLine: "Less than a sixth of a PKR 60,000/mo intake staffer",
    limits: { leads: 500, aiMessages: 2000, workflowRuns: 1000, teamMembers: 2 },
  },
  {
    id: "growth",
    name: "Growth",
    variantId: env.LEMONSQUEEZY_VARIANT_GROWTH,
    pricePKR: 24900,
    priceLabel: "PKR 24,900/mo",
    pitchLine: "Under half the cost of one intake staffer — covers your whole team",
    limits: { leads: 3000, aiMessages: 15000, workflowRuns: 10000, teamMembers: 8 },
  },
  {
    id: "scale",
    name: "Scale",
    variantId: env.LEMONSQUEEZY_VARIANT_SCALE,
    pricePKR: 54900,
    priceLabel: "PKR 54,900/mo",
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
