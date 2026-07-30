import { z } from "zod";

export const createListingSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  priceLabel: z.string().max(60).optional(),
  location: z.string().max(120).optional(),
  imageUrl: z.string().url().optional(),
});

export const updateListingSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  priceLabel: z.string().max(60).optional(),
  location: z.string().max(120).optional(),
  imageUrl: z.string().url().optional(),
  status: z.enum(["ACTIVE", "PAUSED", "SOLD"]).optional(),
});

export const contentPlanRequestSchema = z.object({
  platforms: z.array(z.enum(["INSTAGRAM", "FACEBOOK", "TIKTOK", "LINKEDIN"])).min(1).max(4).default(["INSTAGRAM"]),
  postCount: z.number().int().min(1).max(5).default(3),
});
