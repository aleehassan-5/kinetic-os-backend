import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "@/lib/jwt";
import { prisma } from "@/lib/prisma";
import { UnauthorizedError, ForbiddenError } from "@/lib/errors";

const ACCOUNT_STATUS_MESSAGES: Record<string, string> = {
  PENDING: "Your account is still awaiting approval.",
  REJECTED: "Your account application wasn't approved.",
  SUSPENDED: "Your account has been suspended.",
};

/**
 * Verifies the access token AND, for non-super-admins, re-checks the
 * account's current status against the database on every request — not
 * just at login. A token issued while ACTIVE must stop working the moment
 * an admin flips the account to SUSPENDED, and a stateless JWT alone can't
 * express that; this one extra query is the tradeoff.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(new UnauthorizedError("Missing bearer token"));
  }

  const token = header.slice("Bearer ".length);
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return next(new UnauthorizedError("Invalid or expired access token"));
  }

  if (payload.isSuperAdmin) {
    req.auth = payload;
    return next();
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { account: { select: { status: true } } },
    });

    const status = user?.account?.status;
    if (!status || status !== "ACTIVE") {
      return next(new ForbiddenError(ACCOUNT_STATUS_MESSAGES[status ?? ""] ?? "Your account no longer has access."));
    }

    req.auth = payload;
    return next();
  } catch (err) {
    return next(err);
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

/** Restrict a route to the platform's super_admin(s) only — no client, however senior, can pass this. */
export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(new UnauthorizedError());
  if (!req.auth.isSuperAdmin) return next(new ForbiddenError("Super admin access required"));
  next();
}
