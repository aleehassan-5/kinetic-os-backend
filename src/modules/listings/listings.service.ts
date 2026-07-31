import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { generateChatCompletion } from "@/modules/chat/llm";
import { createPost, listAccounts } from "@/modules/social/social.service";
import { createNotification } from "@/modules/notifications/notifications.service";
import type { SocialPlatform } from "@prisma/client";

export async function listListings(workspaceId: string, status?: string) {
  return prisma.listing.findMany({
    where: { workspaceId, ...(status ? { status: status as "ACTIVE" | "PAUSED" | "SOLD" } : {}) },
    orderBy: { createdAt: "desc" },
  });
}

export async function getListing(workspaceId: string, listingId: string) {
  const listing = await prisma.listing.findFirst({ where: { id: listingId, workspaceId } });
  if (!listing) throw new NotFoundError("Listing not found");
  return listing;
}

export async function createListing(workspaceId: string, input: Record<string, unknown>) {
  return prisma.listing.create({ data: { workspaceId, ...input } as any });
}

export async function updateListing(workspaceId: string, listingId: string, input: Record<string, unknown>) {
  await getListing(workspaceId, listingId); // 404s if not found/not this workspace
  return prisma.listing.update({ where: { id: listingId }, data: input as any });
}

export async function deleteListing(workspaceId: string, listingId: string) {
  await getListing(workspaceId, listingId);
  await prisma.listing.delete({ where: { id: listingId } });
}

interface ContentPlanPost {
  title: string;
  platform: SocialPlatform;
  contentType: "STATIC_GRAPHIC" | "REEL" | "STORY" | "CAROUSEL";
  prompt: string;
}

interface ContentPlan {
  audience: string;
  posts: ContentPlanPost[];
}

const PLAN_SYSTEM_PROMPT = `You are a marketing strategist for a small business. Given a listing/offer, propose a short target-audience description and a handful of concrete social post ideas to promote it. Respond with ONLY a JSON object, no markdown fences, no commentary, matching exactly this shape:
{"audience": "one or two sentences describing who this should be shown to", "posts": [{"title": "short internal title for this post", "platform": "INSTAGRAM"|"FACEBOOK"|"TIKTOK"|"LINKEDIN", "contentType": "STATIC_GRAPHIC"|"REEL"|"STORY"|"CAROUSEL", "prompt": "a creative brief for the AI content generator to actually produce this post"}]}`;

function stripCodeFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

/** Deterministic fallback used only if the LLM response can't be parsed (e.g. no API key configured) — clearly simpler, never presented as if it were a rich AI plan. */
function fallbackPlan(listing: { title: string; location: string | null }, platforms: SocialPlatform[], postCount: number): ContentPlan {
  return {
    audience: `People actively looking for something like "${listing.title}"${listing.location ? ` in ${listing.location}` : ""}.`,
    posts: Array.from({ length: postCount }).map((_, i) => ({
      title: `${listing.title} — post ${i + 1}`,
      platform: platforms[i % platforms.length],
      contentType: "STATIC_GRAPHIC",
      prompt: `Promote "${listing.title}"${listing.location ? ` in ${listing.location}` : ""}. Highlight what makes it worth a closer look.`,
    })),
  };
}

/**
 * Proposes a real, LLM-generated marketing plan for a listing, then
 * actually creates the posts as drafts via the existing social content
 * pipeline (real AI graphic/script/voiceover generation) — not just a
 * plan document sitting unused. Posts are left in DRAFT status; the owner
 * reviews and schedules them from the Social Scheduler, same as any other
 * post, rather than auto-publishing without a human ever looking at them.
 */
export async function proposeAndGenerateContentPlan(
  workspaceId: string,
  listingId: string,
  platforms: SocialPlatform[],
  postCount: number
) {
  const listing = await getListing(workspaceId, listingId);

  const raw = await generateChatCompletion(workspaceId, [
    { role: "system", content: PLAN_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Listing: "${listing.title}". ${listing.description ?? ""} ${listing.priceLabel ?? ""} ${listing.location ?? ""}. Propose ${postCount} post(s) across these platforms: ${platforms.join(", ")}.`,
    },
  ]);

  let plan: ContentPlan;
  try {
    plan = JSON.parse(stripCodeFences(raw));
    if (!plan.audience || !Array.isArray(plan.posts) || plan.posts.length === 0) throw new Error("malformed plan");
  } catch {
    plan = fallbackPlan(listing, platforms, postCount);
  }

  const createdPosts = [];
  for (const idea of plan.posts.slice(0, postCount)) {
    const post = await createPost(workspaceId, {
      title: idea.title,
      platform: idea.platform,
      contentType: idea.contentType,
      prompt: idea.prompt,
      useVoiceover: idea.contentType === "REEL" || idea.contentType === "STORY",
      mode: "draft",
    });
    await prisma.socialPost.update({ where: { id: post.id }, data: { listingId } });
    createdPosts.push(post);
  }

  return { audience: plan.audience, posts: createdPosts };
}

/**
 * The "steps in on its own" half of the pitch: fired automatically the
 * moment a new listing is created (see listings.controller.ts), not behind
 * a button the owner has to remember to click. Picks whichever platforms
 * the workspace already has connected (falls back to Instagram alone if
 * none are connected yet, so it still produces something reviewable),
 * drafts a small plan, and then tells the owner it's done via a real
 * notification — the same content pipeline as the manual endpoint, just
 * initiated by the system instead of a click.
 */
export async function autoProposeContentPlan(workspaceId: string, listingId: string): Promise<void> {
  try {
    const listing = await getListing(workspaceId, listingId);
    const accounts = await listAccounts(workspaceId);
    const connectedPlatforms = Array.from(
      new Set(accounts.filter((a: { status: string }) => a.status === "CONNECTED").map((a: { platform: SocialPlatform }) => a.platform))
    ) as SocialPlatform[];
    const platforms = connectedPlatforms.length > 0 ? connectedPlatforms.slice(0, 2) : (["INSTAGRAM"] as SocialPlatform[]);

    const { posts } = await proposeAndGenerateContentPlan(workspaceId, listingId, platforms, 2);

    await createNotification(workspaceId, {
      type: "SYSTEM",
      title: "New content ideas ready to review",
      description: `Drafted ${posts.length} post idea(s) for "${listing.title}" — review and schedule them from the Social Scheduler.`,
    });
  } catch (err) {
    // Never let a background content-suggestion failure affect the listing
    // itself — the owner can still trigger the manual endpoint if this fails.
    logger.error({ err: (err as Error).message, workspaceId, listingId }, "auto content-plan generation failed");
  }
}
