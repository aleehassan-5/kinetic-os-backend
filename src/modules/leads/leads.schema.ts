import { z } from "zod";

export const listLeadsQuerySchema = z.object({
  channel: z.enum(["WHATSAPP", "TELEGRAM", "INSTAGRAM", "MESSENGER", "EMAIL"]).optional(),
  status: z.enum(["NEW", "ENGAGED", "QUALIFIED", "MEETING_BOOKED", "CLOSED", "LOST"]).optional(),
  search: z.string().optional(),
  minIntentScore: z.coerce.number().min(0).max(100).optional(),
  sortBy: z.enum(["recent", "intentScore"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

export const replySchema = z.object({
  text: z.string().min(1).max(4000),
});
