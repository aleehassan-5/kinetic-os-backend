#!/usr/bin/env node
/**
 * Generates fresh, cryptographically random values for every secret that
 * ships with a public/default fallback in .env.example — run this before
 * deploying to production, and paste the output into your real .env
 * (never commit it). server.ts already refuses to boot in production if
 * any of these are left at their default value.
 *
 * Usage: npm run generate:secrets
 */
const { randomBytes } = require("crypto");

function randomHex(bytes) {
  return randomBytes(bytes).toString("hex");
}

const secrets = {
  JWT_ACCESS_SECRET: randomHex(32),
  JWT_REFRESH_SECRET: randomHex(32),
  CREDENTIALS_ENCRYPTION_KEY: randomHex(32),
  TELEGRAM_WEBHOOK_SECRET: randomHex(24),
  WHATSAPP_VERIFY_TOKEN: randomHex(24),
  META_VERIFY_TOKEN: randomHex(24),
  INBOUND_EMAIL_WEBHOOK_SECRET: randomHex(24),
};

console.log("# Generated secrets — paste these into your production .env, then delete this output.");
console.log("# (Each run produces different values — re-run any time you need to rotate one.)\n");
for (const [key, value] of Object.entries(secrets)) {
  console.log(`${key}=${value}`);
}
