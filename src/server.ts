import { env } from "@/config/env";
import { initSentry } from "@/lib/sentry";

// Must run before anything else does real work, so Sentry can catch
// errors from as early in the process lifetime as possible.
initSentry();

import { app } from "@/app";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { subscribeWorkflowsToEvents } from "@/modules/workflows/workflow.service";
import { installCrashSafetyNet } from "@/lib/process-safety-net";

installCrashSafetyNet("api-server");

// These ship with hardcoded fallback values (e.g. "orbit-telegram-secret") so
// local/dev setups work out of the box — but those fallbacks are sitting in
// this public repo's source, so anyone can read them. Running production
// with the defaults means the corresponding webhook has no real
// verification. Fail fast instead of silently accepting forged requests.
function assertProductionSecretsAreOverridden() {
  if (env.NODE_ENV !== "production") return;

  const problems: string[] = [];
  if (env.TELEGRAM_WEBHOOK_SECRET === "orbit-telegram-secret") {
    problems.push("TELEGRAM_WEBHOOK_SECRET is still the default value — set it to a unique random string.");
  }
  if (env.WHATSAPP_VERIFY_TOKEN === "orbit-whatsapp-verify") {
    problems.push("WHATSAPP_VERIFY_TOKEN is still the default value — set it to a unique random string.");
  }
  if (env.META_VERIFY_TOKEN === "orbit-meta-verify") {
    problems.push("META_VERIFY_TOKEN is still the default value — set it to a unique random string.");
  }
  if (env.INBOUND_EMAIL_WEBHOOK_SECRET === "orbit-email-secret") {
    problems.push("INBOUND_EMAIL_WEBHOOK_SECRET is still the default value — set it to a unique random string.");
  }
  // Unlike the verify-token defaults above, these two have NO hardcoded
  // fallback — but leaving them empty means the adapters skip signature
  // verification ENTIRELY (see whatsapp.adapter.ts / meta-messaging.shared.ts),
  // so any request claiming to be from Meta is accepted with no proof at all.
  if (!env.WHATSAPP_APP_SECRET) {
    problems.push(
      "WHATSAPP_APP_SECRET is not set — WhatsApp webhook signature verification is completely skipped without it, " +
        "so anyone could POST forged inbound messages to /webhooks/whatsapp."
    );
  }
  if (!env.META_APP_SECRET) {
    problems.push(
      "META_APP_SECRET is not set — Instagram/Messenger webhook signature verification is completely skipped " +
        "without it, so anyone could POST forged inbound messages to those webhooks."
    );
  }
  if (!env.CREDENTIALS_ENCRYPTION_KEY) {
    problems.push(
      "CREDENTIALS_ENCRYPTION_KEY is not set — connected channel credentials would be encrypted with a key " +
        "derived from JWT_ACCESS_SECRET instead of their own dedicated secret. Set a separate random value."
    );
  }

  if (problems.length > 0) {
    logger.error({ problems }, "Refusing to start in production with insecure default secrets");
    throw new Error(`Insecure configuration for production:\n- ${problems.join("\n- ")}`);
  }
}

async function main() {
  assertProductionSecretsAreOverridden();

  await prisma.$connect();
  logger.info("Database connected");

  subscribeWorkflowsToEvents();

  const server = app.listen(env.PORT, () => {
    logger.info(`Orbit AI backend listening on http://localhost:${env.PORT}`);
    logger.info(`Health check: http://localhost:${env.PORT}/health`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down gracefully…`);
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "Fatal error during startup");
  process.exit(1);
});
