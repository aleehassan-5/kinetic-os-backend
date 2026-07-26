import { env } from "@/config/env";
import { app } from "@/app";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { subscribeWorkflowsToEvents } from "@/modules/workflows/workflow.service";

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
