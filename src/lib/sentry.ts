import * as Sentry from "@sentry/node";
import { env } from "@/config/env";

export const sentryEnabled = Boolean(env.SENTRY_DSN);

/** Call this first, before anything else imports/uses the app — Sentry needs to patch modules early to auto-instrument them. */
export function initSentry() {
  if (!sentryEnabled) return;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 0,
  });
}

export { Sentry };
