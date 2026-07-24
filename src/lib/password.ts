import bcrypt from "bcryptjs";
import { createHash } from "crypto";

const SALT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Deterministic SHA-256 hash for opaque secrets we need to look up by exact
 * value later (refresh tokens, API keys). bcrypt is intentionally NOT used
 * here because its per-hash salt makes equality lookups impossible.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
