import { randomUUID } from "crypto";
import { spawn } from "child_process";
import path from "path";
import { logger } from "@/lib/logger";
import { MEDIA_DIR, MEDIA_URL_PREFIX, publicUrlToLocalPath } from "@/lib/media-storage";
import { env } from "@/config/env";

/**
 * Runs the ffmpeg CLI directly (no fluent-ffmpeg dependency needed) to
 * produce a real mp4: the still image held for the full length of the
 * audio track, audio muxed in. Requires an `ffmpeg` binary on PATH —
 * install it on the server (e.g. `apt-get install ffmpeg`, or use a base
 * Docker image that includes it) for this to work in production.
 */
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args);
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err) => {
      reject(new Error(`ffmpeg not available (${err.message}) — is it installed on this server?`));
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-800)}`));
    });
  });
}

/**
 * Combines a locally-stored image and audio file (both must already be
 * saved via media-storage, i.e. their URLs start with our MEDIA_URL_PREFIX)
 * into a single mp4 reel, saved to the same storage. Returns its public URL.
 */
export async function assembleReelVideo(imagePublicUrl: string, audioPublicUrl: string): Promise<string> {
  const imagePath = publicUrlToLocalPath(imagePublicUrl);
  const audioPath = publicUrlToLocalPath(audioPublicUrl);
  const outFilename = `${randomUUID()}.mp4`;
  const outPath = path.join(MEDIA_DIR, outFilename);

  // -loop 1: hold the still image for the whole clip
  // -shortest: stop once the (shorter) audio track ends
  // -vf scale+pad: normalize to a 1080x1920 vertical reel frame regardless of source image aspect ratio
  await runFfmpeg([
    "-y",
    "-loop", "1",
    "-i", imagePath,
    "-i", audioPath,
    "-c:v", "libx264",
    "-tune", "stillimage",
    "-c:a", "aac",
    "-b:a", "192k",
    "-pix_fmt", "yuv420p",
    "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
    "-shortest",
    outPath,
  ]);

  logger.info({ outFilename }, "[social] assembled reel video");
  return `${env.API_PUBLIC_URL}${MEDIA_URL_PREFIX}/${outFilename}`;
}

/** True if the `ffmpeg` binary is reachable on PATH — checked once at generation time so we can fall back gracefully instead of failing the whole post. */
export async function isFfmpegAvailable(): Promise<boolean> {
  try {
    await runFfmpeg(["-version"]);
    return true;
  } catch {
    return false;
  }
}
