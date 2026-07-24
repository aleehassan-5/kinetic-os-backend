import { z } from "zod";

export const listPostsQuerySchema = z.object({
  status: z.enum(["DRAFT", "GENERATING", "SCHEDULED", "PUBLISHED", "FAILED"]).optional(),
  platform: z.enum(["INSTAGRAM", "FACEBOOK", "TIKTOK", "LINKEDIN"]).optional(),
});

export const createPostSchema = z.object({
  title: z.string().min(1).max(200),
  platform: z.enum(["INSTAGRAM", "FACEBOOK", "TIKTOK", "LINKEDIN"]),
  contentType: z.enum(["REEL", "STATIC_GRAPHIC", "CAROUSEL", "STORY"]),
  prompt: z.string().max(2000).optional(),
  useVoiceover: z.boolean().default(false),
  scheduledAt: z.string().datetime().optional(), // omit for draft-only
  mode: z.enum(["draft", "generate_and_schedule"]).default("draft"),
});

export const updatePostSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  caption: z.string().optional(),
  script: z.string().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
});

export const connectAccountSchema = z.object({
  platform: z.enum(["INSTAGRAM", "FACEBOOK", "TIKTOK", "LINKEDIN"]),
  externalId: z.string().min(1),
  displayName: z.string().optional(),
  autoReplyComments: z.boolean().default(false),
});
