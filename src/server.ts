import { env } from "@/config/env";
import { app } from "@/app";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { subscribeWorkflowsToEvents } from "@/modules/workflows/workflow.service";

async function main() {
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
