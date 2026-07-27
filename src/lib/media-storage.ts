import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { env } from "@/config/env";

export const MEDIA_DIR = path.join(process.cwd(), "storage", "media");
export const MEDIA_URL_PREFIX = "/media";

let ensured = false;
async function ensureDir() {
  if (ensured) return;
  await mkdir(MEDIA_DIR, { recursive: true });
  ensured = true;
}

/** Saves a buffer to local disk and returns the full public URL it's served at. */
export async function saveMediaBuffer(buffer: Buffer, extension: string): Promise<string> {
  await ensureDir();
  const filename = `${randomUUID()}.${extension}`;
  await writeFile(path.join(MEDIA_DIR, filename), buffer);
  return `${env.API_PUBLIC_URL}${MEDIA_URL_PREFIX}/${filename}`;
}

/** Saves a base64 data URL (data:image/png;base64,...) to disk, returning a real public URL. */
export async function saveDataUrl(dataUrl: string): Promise<string> {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("saveDataUrl: not a base64 data URL");
  const [, mime, b64] = match;
  const extension = mime.split("/")[1]?.replace("svg+xml", "svg") ?? "bin";
  return saveMediaBuffer(Buffer.from(b64, "base64"), extension);
}

/** Downloads a remote URL (e.g. an OpenAI-hosted image that expires) and re-hosts it locally so it doesn't disappear before a scheduled post publishes. */
export async function rehostRemoteUrl(url: string, extension: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`rehostRemoteUrl: failed to fetch ${url} (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return saveMediaBuffer(buffer, extension);
}

/** Resolves a saved public media URL back to its local file path (for e.g. ffmpeg to read as input). */
export function publicUrlToLocalPath(publicUrl: string): string {
  const filename = publicUrl.split(`${MEDIA_URL_PREFIX}/`).pop();
  if (!filename) throw new Error(`publicUrlToLocalPath: not a local media URL: ${publicUrl}`);
  return path.join(MEDIA_DIR, filename);
}
