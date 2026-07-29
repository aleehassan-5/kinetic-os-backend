import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  APP_URL: z.string().default("http://localhost:4000"),
  WEB_APP_URL: z.string().default("http://localhost:3000"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET must be set to a long random string"),
  JWT_REFRESH_SECRET: z.string().min(16, "JWT_REFRESH_SECRET must be set to a long random string"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("30d"),

  // Encrypts per-workspace channel credentials (WhatsApp/Telegram/Instagram tokens
  // customers connect themselves) at rest. Falls back to JWT_ACCESS_SECRET if unset.
  CREDENTIALS_ENCRYPTION_KEY: z.string().optional().default(""),

  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_CHAT_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  OPENAI_IMAGE_MODEL: z.string().default("gpt-image-1"),
  ANTHROPIC_API_KEY: z.string().optional().default(""),

  WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(""),
  WHATSAPP_ACCESS_TOKEN: z.string().optional().default(""),
  WHATSAPP_VERIFY_TOKEN: z.string().default("orbit-whatsapp-verify"),
  WHATSAPP_APP_SECRET: z.string().optional().default(""),

  TELEGRAM_BOT_TOKEN: z.string().optional().default(""),
  TELEGRAM_WEBHOOK_SECRET: z.string().default("orbit-telegram-secret"),

  META_APP_ID: z.string().optional().default(""),
  META_APP_SECRET: z.string().optional().default(""),
  META_PAGE_ACCESS_TOKEN: z.string().optional().default(""),
  META_VERIFY_TOKEN: z.string().default("orbit-meta-verify"),

  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASS: z.string().optional().default(""),
  SMTP_FROM: z.string().default("Kinetic OS <hello@kineticos.app>"),
  INBOUND_EMAIL_WEBHOOK_SECRET: z.string().default("orbit-email-secret"),

  CALENDLY_ACCESS_TOKEN: z.string().optional().default(""),
  CALENDLY_WEBHOOK_SIGNING_KEY: z.string().optional().default(""),
  CALENDLY_EVENT_TYPE_URI: z.string().optional().default(""), // e.g. https://api.calendly.com/event_types/AAAAAAAAAAAAAAAA
  GOOGLE_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(""),
  GOOGLE_REDIRECT_URI: z.string().optional().default(""),
  // "Continue with Google" sign-in — separate callback from the Calendar
  // integration above since it carries a different scope and outcome.
  GOOGLE_LOGIN_REDIRECT_URI: z.string().default("http://localhost:4000/auth/google/callback"),
  // Google Calendar booking uses the same service account as Google Sheets
  // sync (GOOGLE_SERVICE_ACCOUNT_EMAIL / _PRIVATE_KEY below) — just share
  // this specific calendar with that service account email as an editor.
  GOOGLE_CALENDAR_ID: z.string().optional().default(""),

  // The externally-reachable base URL of this API (e.g. https://api.kineticos.app
  // or an ngrok/tunnel URL in dev). Needed to build real, stable, publicly
  // fetchable links to locally-generated media (graphics/voiceovers/reels) —
  // Instagram/TikTok/Facebook's publish APIs fetch media server-side from a
  // URL, they don't accept inline base64 data URLs.
  API_PUBLIC_URL: z.string().default("http://localhost:4000"),

  // Error monitoring — leave blank to skip (errors still get logged via
  // pino either way, just not reported anywhere outside this server).
  SENTRY_DSN: z.string().optional().default(""),

  HUBSPOT_ACCESS_TOKEN: z.string().optional().default(""),
  GOOGLE_SHEETS_SPREADSHEET_ID: z.string().optional().default(""),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional().default(""),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().optional().default(""),

  ELEVENLABS_API_KEY: z.string().optional().default(""),

  // Social media content engine — publishing
  INSTAGRAM_BUSINESS_ACCOUNT_ID: z.string().optional().default(""),
  FACEBOOK_PAGE_ID: z.string().optional().default(""),
  TIKTOK_ACCESS_TOKEN: z.string().optional().default(""),
  LINKEDIN_ACCESS_TOKEN: z.string().optional().default(""),
  LINKEDIN_ORGANIZATION_URN: z.string().optional().default(""), // e.g. "urn:li:organization:12345"

  LEMONSQUEEZY_API_KEY: z.string().optional().default(""),
  LEMONSQUEEZY_STORE_ID: z.string().optional().default(""),
  LEMONSQUEEZY_WEBHOOK_SECRET: z.string().optional().default(""),
  LEMONSQUEEZY_VARIANT_STARTER: z.string().optional().default(""),
  LEMONSQUEEZY_VARIANT_GROWTH: z.string().optional().default(""),
  LEMONSQUEEZY_VARIANT_SCALE: z.string().optional().default(""),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("❌ Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
