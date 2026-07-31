import { logger } from "@/lib/logger";
import { saveMediaBuffer } from "@/lib/media-storage";
import { resolveAiKey } from "@/modules/ai-providers/ai-providers.service";
import type { VoiceoverResult } from "./social.types";

const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // ElevenLabs' default "Rachel" voice

/**
 * Synthesizes a voiceover for a reel/story script. Without an ElevenLabs key
 * configured (per-workspace or deployment-wide), returns null so the
 * pipeline still completes (the frontend shows the script but no audio)
 * instead of failing the whole post generation.
 */
export async function generateVoiceover(workspaceId: string, script: string): Promise<VoiceoverResult> {
  const apiKey = await resolveAiKey(workspaceId, "ELEVENLABS");
  if (!apiKey) {
    logger.warn("[voiceover] no ElevenLabs key configured — skipping audio synthesis (script still generated)");
    return { voiceoverUrl: null, provider: "local-stub" };
  }

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${DEFAULT_VOICE_ID}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
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
  const voiceoverUrl = await saveMediaBuffer(buffer, "mp3");
  return { voiceoverUrl, provider: "elevenlabs" };
}
