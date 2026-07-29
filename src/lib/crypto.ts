import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { env } from "@/config/env";

// Derives a stable 32-byte key from CREDENTIALS_ENCRYPTION_KEY (or, if that
// isn't set, from JWT_ACCESS_SECRET so there's no extra required setup in
// dev/single-tenant deployments). Set a dedicated CREDENTIALS_ENCRYPTION_KEY
// in production.
const key = scryptSync(env.CREDENTIALS_ENCRYPTION_KEY || env.JWT_ACCESS_SECRET, "kinetic-os-credentials", 32);

/** Encrypts an arbitrary JSON-serializable value for storage in a Json column. Format: iv:authTag:ciphertext (all hex). */
export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptJson<T>(payload: string): T {
  const [ivHex, authTagHex, dataHex] = payload.split(":");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}
