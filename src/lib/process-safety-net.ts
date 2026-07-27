import { logger } from "@/lib/logger";
import { Sentry, sentryEnabled } from "@/lib/sentry";

/**
 * Call once per process (API server, workflow worker, social worker).
 * Without this, an unhandled rejection or thrown error outside a request
 * handler either crashes with no report anywhere, or leaves the process
 * "running" in a broken state. This reports it, then exits so the process
 * manager (Docker/PM2/systemd) restarts a clean instance.
 */
export function installCrashSafetyNet(processName: string) {
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason, process: processName }, "Unhandled promise rejection — crashing intentionally");
    if (sentryEnabled) Sentry.captureException(reason);
    process.exit(1);
  });

  process.on("uncaughtException", (err) => {
    logger.error({ err, process: processName }, "Uncaught exception — crashing intentionally");
    if (sentryEnabled) Sentry.captureException(err);
    process.exit(1);
  });
}
