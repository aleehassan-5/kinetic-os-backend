import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import { generateChatCompletion } from "@/modules/chat/llm";
import { saveDataUrl, rehostRemoteUrl } from "@/lib/media-storage";
import type { SocialContentType } from "@prisma/client";
import type { GeneratedAsset } from "./social.types";

/**
 * A deterministic, dependency-free "poster" placeholder — an inline SVG,
 * saved to real storage below (same as every other generated asset) so
 * even the no-API-keys stub mode produces a genuinely publishable URL.
 * Swap for the real OpenAI Images call once billed.
 */
async function localStubGraphic(title: string, contentType: SocialContentType): Promise<string> {
  const bg = contentType === "REEL" || contentType === "STORY" ? "#141225" : "#1B1832";
  const safeTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").slice(0, 90);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080">
  <rect width="100%" height="100%" fill="${bg}"/>
  <rect x="40" y="40" width="1000" height="1000" fill="none" stroke="#7C5CFF" stroke-width="3" rx="24"/>
  <text x="80" y="520" fill="#FFFFFF" font-family="sans-serif" font-size="52" font-weight="700">
    <tspan x="80" dy="0">${safeTitle}</tspan>
  </text>
  <text x="80" y="1000" fill="#7C5CFF" font-family="sans-serif" font-size="28">Orbit AI — auto-generated</text>
</svg>`;
  return saveDataUrl(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
}

async function generateCaption(title: string, prompt: string | undefined, contentType: SocialContentType): Promise<string> {
  const brief = `Write a short, high-engagement social caption for a ${contentType.toLowerCase().replace("_", " ")} post titled "${title}". ${
    prompt ? `Context: ${prompt}` : ""
  } Keep it under 220 characters, end with 3-4 relevant hashtags. Return ONLY the caption text, nothing else.`;

  const text = await generateChatCompletion([
    { role: "system", content: "You are a social media copywriter for a B2B AI automation agency." },
    { role: "user", content: brief },
  ]);
  return text.trim();
}

async function generateReelScript(title: string, prompt: string | undefined): Promise<string> {
  const brief = `Write a 20-25 second voiceover script (roughly 60-70 words) for a short-form video reel titled "${title}". ${
    prompt ? `Context: ${prompt}` : ""
  } Punchy hook in the first line, one clear takeaway, end with a soft call-to-action. Return ONLY the script text.`;

  return (
    await generateChatCompletion([
      { role: "system", content: "You are a scriptwriter for short-form marketing video reels." },
      { role: "user", content: brief },
    ])
  ).trim();
}

async function generateGraphicViaOpenAI(title: string, prompt: string | undefined): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.OPENAI_IMAGE_MODEL,
      prompt: `Clean, modern social media marketing graphic. Title/hook: "${title}". ${prompt ?? ""}. Bold typography, on-brand purple/dark palette, no watermarks.`,
      size: "1024x1024",
      n: 1,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI image generation failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as { data: Array<{ url?: string; b64_json?: string }> };
  const image = data.data[0];
  // OpenAI's hosted image URLs expire (~1 hour) — useless for a post scheduled
  // for later, and Instagram/TikTok/Facebook fetch media server-side at
  // publish time, so we re-host it on our own storage immediately instead.
  if (image.url) return rehostRemoteUrl(image.url, "png");
  if (image.b64_json) return saveDataUrl(`data:image/png;base64,${image.b64_json}`);
  throw new Error("OpenAI image generation returned no image data");
}

/**
 * Generates the full creative package for a scheduled post: a graphic/thumbnail,
 * a caption, and (for video content types) a voiceover script.
 */
export async function generatePostAssets(
  title: string,
  prompt: string | undefined,
  contentType: SocialContentType
): Promise<GeneratedAsset> {
  const isVideo = contentType === "REEL" || contentType === "STORY";

  const [caption, script, mediaUrl] = await Promise.all([
    generateCaption(title, prompt, contentType).catch((err) => {
      logger.warn({ err: (err as Error).message }, "[social] caption generation failed, using fallback");
      return `${title} ✨ #automation #AI #growth`;
    }),
    isVideo
      ? generateReelScript(title, prompt).catch((err) => {
          logger.warn({ err: (err as Error).message }, "[social] script generation failed, using fallback");
          return `Here's ${title.toLowerCase()}. Stick around — this one's worth it. Follow for more.`;
        })
      : Promise.resolve(undefined),
    env.OPENAI_API_KEY
      ? generateGraphicViaOpenAI(title, prompt).catch((err) => {
          logger.warn({ err: (err as Error).message }, "[social] image generation failed, using local stub graphic");
          return localStubGraphic(title, contentType);
        })
      : Promise.resolve(localStubGraphic(title, contentType)),
  ]);

  return { mediaUrl, caption, script };
}
