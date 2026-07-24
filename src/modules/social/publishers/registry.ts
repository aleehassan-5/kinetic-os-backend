import type { SocialPlatform } from "@prisma/client";
import type { SocialPublisher } from "../social.types";
import { instagramPublisher } from "./instagram.publisher";
import { facebookPublisher } from "./facebook.publisher";
import { tiktokPublisher } from "./tiktok.publisher";
import { linkedinPublisher } from "./linkedin.publisher";

export const socialPublishers: Record<SocialPlatform, SocialPublisher> = {
  INSTAGRAM: instagramPublisher,
  FACEBOOK: facebookPublisher,
  TIKTOK: tiktokPublisher,
  LINKEDIN: linkedinPublisher,
};

export function getPublisher(platform: SocialPlatform): SocialPublisher {
  return socialPublishers[platform];
}
