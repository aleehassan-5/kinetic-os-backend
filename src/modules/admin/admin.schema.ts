import { z } from "zod";

export const accountStatusFilterSchema = z.object({
  status: z.enum(["PENDING", "ACTIVE", "REJECTED", "SUSPENDED"]).optional(),
});

export const rejectAccountSchema = z.object({
  reason: z.string().max(500).optional(),
});

export type AccountStatusFilter = z.infer<typeof accountStatusFilterSchema>;
export type RejectAccountInput = z.infer<typeof rejectAccountSchema>;
