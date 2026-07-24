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
  priceLabel: string;
  limits: PlanLimits;
}

export const PLANS: PlanConfig[] = [
  {
    id: "starter",
    name: "Starter",
    variantId: env.LEMONSQUEEZY_VARIANT_STARTER,
    priceLabel: "$29/mo",
    limits: { leads: 500, aiMessages: 2000, workflowRuns: 1000, teamMembers: 2 },
  },
  {
    id: "growth",
    name: "Growth",
    variantId: env.LEMONSQUEEZY_VARIANT_GROWTH,
    priceLabel: "$99/mo",
    limits: { leads: 3000, aiMessages: 15000, workflowRuns: 10000, teamMembers: 8 },
  },
  {
    id: "scale",
    name: "Scale",
    variantId: env.LEMONSQUEEZY_VARIANT_SCALE,
    priceLabel: "$299/mo",
    limits: { leads: 20000, aiMessages: 100000, workflowRuns: 100000, teamMembers: 25 },
  },
];

export function getPlanById(planId: string): PlanConfig {
  return PLANS.find((p) => p.id === planId) ?? PLANS[0];
}

export function getPlanByVariantId(variantId: string): PlanConfig | undefined {
  return PLANS.find((p) => p.variantId === variantId);
}
