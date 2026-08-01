import { z } from "zod";

export const socialPlatformSchema = z.enum(["INSTAGRAM", "FACEBOOK", "TIKTOK", "LINKEDIN"]);

export const connectSocialAccountSchema = z.discriminatedUnion("platform", [
  z.object({
    platform: z.literal("INSTAGRAM"),
    pageAccessToken: z.string().min(1),
    igBusinessAccountId: z.string().min(1),
  }),
  z.object({
    platform: z.literal("FACEBOOK"),
    pageAccessToken: z.string().min(1),
    pageId: z.string().min(1),
  }),
  z.object({
    platform: z.literal("TIKTOK"),
    accessToken: z.string().min(1),
  }),
  z.object({
    platform: z.literal("LINKEDIN"),
    accessToken: z.string().min(1),
    organizationUrn: z.string().min(1),
  }),
]);

export type SocialPlatformId = z.infer<typeof socialPlatformSchema>;
export type ConnectSocialAccountInput = z.infer<typeof connectSocialAccountSchema>;
