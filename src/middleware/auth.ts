import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "@/lib/jwt";
import { UnauthorizedError, ForbiddenError } from "@/lib/errors";

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(new UnauthorizedError("Missing bearer token"));
  }

  const token = header.slice("Bearer ".length);
  try {
    req.auth = verifyAccessToken(token);
    return next();
  } catch {
    return next(new UnauthorizedError("Invalid or expired access token"));
  }
}

/** Restrict a route to specific membership roles, e.g. requireRole("OWNER", "ADMIN"). */
export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(new UnauthorizedError());
    if (!roles.includes(req.auth.role)) return next(new ForbiddenError("You don't have permission to do this"));
    next();
  };
}
