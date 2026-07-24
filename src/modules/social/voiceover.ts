import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import type { VoiceoverResult } from "./social.types";

const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // ElevenLabs' default "Rachel" voice

/**
 * Synthesizes a voiceover for a reel/story script. Without ELEVENLABS_API_KEY
 * set, returns null so the pipeline still completes (the frontend shows the
 * script but no audio) instead of failing the whole post generation.
 */
export async function generateVoiceover(script: string): Promise<VoiceoverResult> {
  if (!env.ELEVENLABS_API_KEY) {
    logger.warn("[voiceover] no ELEVENLABS_API_KEY set — skipping audio synthesis (script still generated)");
    return { voiceoverUrl: null, provider: "local-stub" };
  }

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${DEFAULT_VOICE_ID}`, {
    method: "POST",
    headers: {
      "xi-api-key": env.ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: script,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.45, similarity_boost: 0.75 },
    }),
  });

  if (!res.ok) {
    logger.error({ status: res.status }, "[voiceover] ElevenLabs synthesis failed — continuing without audio");
    return { voiceoverUrl: null, provider: "local-stub" };
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  // Real deployments should upload this buffer to object storage (S3/R2/Cloudinary)
  // and return the public URL. Inlined as a data URL here so the pipeline has
  // no hard dependency on a storage provider being configured.
  return { voiceoverUrl: `data:audio/mpeg;base64,${buffer.toString("base64")}`, provider: "elevenlabs" };
}
