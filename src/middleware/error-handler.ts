import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { Sentry, sentryEnabled } from "@/lib/sentry";

/** Wraps an async route handler so rejected promises reach the error middleware. */
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(422).json({
      error: "Validation failed",
      issues: err.flatten().fieldErrors,
    });
  }

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err }, err.message);
      if (sentryEnabled) Sentry.captureException(err);
    }
    return res.status(err.statusCode).json({ error: err.message, details: err.details });
  }

  logger.error({ err }, "Unhandled error");
  if (sentryEnabled) Sentry.captureException(err);
  return res.status(500).json({ error: "Internal server error" });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}
