import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword, comparePassword, hashToken } from "@/lib/password";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "@/lib/jwt";
import { ConflictError, UnauthorizedError, ForbiddenError } from "@/lib/errors";
import { sendMail, resetPasswordEmailTemplate } from "@/lib/mailer";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import type { ForgotPasswordInput, LoginInput, RegisterInput, ResetPasswordInput } from "./auth.schema";
import type { GoogleProfile } from "@/lib/google-oauth";
import type { Prisma } from "@prisma/client";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

async function issueTokenPair(userId: string, workspaceId: string, role: string) {
  const accessToken = signAccessToken({ userId, workspaceId, role });
  const refreshToken = signRefreshToken(userId);

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  return { accessToken, refreshToken };
}

export async function register(input: RegisterInput) {
  // This is deployed per-client as a single-tenant instance — the first
  // person to sign up owns it, and the door closes after that. New team
  // members join via invite (POST /team/invite) instead, not open signup.
  const existingWorkspaceCount = await prisma.workspace.count();
  if (existingWorkspaceCount > 0) {
    throw new ForbiddenError("Signups are closed — this instance is already set up for a business. Ask your admin for a team invite instead.");
  }

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new ConflictError("An account with this email already exists");

  const passwordHash = await hashPassword(input.password);

  const { user, membership } = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const workspace = await tx.workspace.create({
      data: { name: input.workspaceName, slug: slugify(input.workspaceName) },
    });

    const user = await tx.user.create({
      data: { name: input.name, email: input.email, passwordHash },
    });

    const membership = await tx.membership.create({
      data: {
        userId: user.id,
        workspaceId: workspace.id,
        role: "OWNER",
        status: "ACTIVE",
        joinedAt: new Date(),
      },
    });

    // Seed default (disconnected) integrations so the Settings/Integrations
    // page has real rows to render against from day one.
    await tx.integration.createMany({
      data: (
        ["WHATSAPP", "TELEGRAM", "INSTAGRAM", "MESSENGER", "EMAIL", "CALENDLY", "GOOGLE_CALENDAR", "HUBSPOT", "GOOGLE_SHEETS"] as const
      ).map((type) => ({ workspaceId: workspace.id, type, status: "NOT_CONNECTED" as const })),
    });

    return { user, membership };
  });

  const tokens = await issueTokenPair(user.id, membership.workspaceId, membership.role);
  return { user: sanitizeUser(user), ...tokens };
}

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { memberships: { where: { status: "ACTIVE" }, orderBy: { joinedAt: "asc" }, take: 1 } },
  });
  if (!user) throw new UnauthorizedError("Invalid email or password");
  if (!user.passwordHash) {
    throw new UnauthorizedError("This account uses Google sign-in. Continue with Google instead.");
  }

  const valid = await comparePassword(input.password, user.passwordHash);
  if (!valid) throw new UnauthorizedError("Invalid email or password");

  const membership = user.memberships[0];
  if (!membership) throw new UnauthorizedError("This account has no active workspace");

  await prisma.membership.update({ where: { id: membership.id }, data: { lastActiveAt: new Date() } });

  const tokens = await issueTokenPair(user.id, membership.workspaceId, membership.role);
  return { user: sanitizeUser(user), ...tokens };
}

export async function refresh(refreshTokenRaw: string) {
  let payload: { userId: string };
  try {
    payload = verifyRefreshToken(refreshTokenRaw);
  } catch {
    throw new UnauthorizedError("Invalid or expired refresh token");
  }

  const tokenHash = hashToken(refreshTokenRaw);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new UnauthorizedError("Refresh token is no longer valid");
  }

  const membership = await prisma.membership.findFirst({
    where: { userId: payload.userId, status: "ACTIVE" },
    orderBy: { joinedAt: "asc" },
  });
  if (!membership) throw new UnauthorizedError("No active workspace for this user");

  // Rotate: revoke the used token, issue a new pair.
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
  return issueTokenPair(payload.userId, membership.workspaceId, membership.role);
}

export async function loginWithGoogle(profile: GoogleProfile) {
  // 1) Already linked to this Google account — sign them in directly.
  let user = await prisma.user.findUnique({
    where: { googleId: profile.googleId },
    include: { memberships: { where: { status: "ACTIVE" }, orderBy: { joinedAt: "asc" }, take: 1 } },
  });

  // 2) An email/password account with the same email exists — link Google to it
  //    instead of creating a duplicate account for the same person.
  if (!user) {
    const existingByEmail = await prisma.user.findUnique({
      where: { email: profile.email },
      include: { memberships: { where: { status: "ACTIVE" }, orderBy: { joinedAt: "asc" }, take: 1 } },
    });
    if (existingByEmail) {
      user = await prisma.user.update({
        where: { id: existingByEmail.id },
        data: { googleId: profile.googleId, avatarUrl: existingByEmail.avatarUrl ?? profile.avatarUrl },
        include: { memberships: { where: { status: "ACTIVE" }, orderBy: { joinedAt: "asc" }, take: 1 } },
      });
    }
  }

  // 3) Brand new person — create their workspace the same way register() does.
  //    Same single-tenant lock as register(): only the first signup gets to
  //    create a workspace this way. Existing members (paths 1/2 above) keep
  //    working normally regardless — this only blocks new outsiders.
  if (!user) {
    const existingWorkspaceCount = await prisma.workspace.count();
    if (existingWorkspaceCount > 0) {
      throw new ForbiddenError("Signups are closed — this instance is already set up for a business. Ask your admin for a team invite instead.");
    }

    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const workspaceName = `${profile.name}'s Workspace`;
      const workspace = await tx.workspace.create({
        data: { name: workspaceName, slug: slugify(workspaceName) },
      });

      const newUser = await tx.user.create({
        data: { name: profile.name, email: profile.email, googleId: profile.googleId, avatarUrl: profile.avatarUrl },
      });

      const membership = await tx.membership.create({
        data: { userId: newUser.id, workspaceId: workspace.id, role: "OWNER", status: "ACTIVE", joinedAt: new Date() },
      });

      await tx.integration.createMany({
        data: (
          ["WHATSAPP", "TELEGRAM", "INSTAGRAM", "MESSENGER", "EMAIL", "CALENDLY", "GOOGLE_CALENDAR", "HUBSPOT", "GOOGLE_SHEETS"] as const
        ).map((type) => ({ workspaceId: workspace.id, type, status: "NOT_CONNECTED" as const })),
      });

      return { newUser, membership };
    });

    user = { ...created.newUser, memberships: [created.membership] };
  }

  const membership = user.memberships[0];
  if (!membership) throw new UnauthorizedError("This account has no active workspace");

  await prisma.membership.update({ where: { id: membership.id }, data: { lastActiveAt: new Date() } });

  const tokens = await issueTokenPair(user.id, membership.workspaceId, membership.role);
  return { user: sanitizeUser(user), ...tokens };
}

export async function logout(refreshTokenRaw: string) {
  const tokenHash = hashToken(refreshTokenRaw);
  await prisma.refreshToken.updateMany({ where: { tokenHash }, data: { revokedAt: new Date() } });
}

export async function me(userId: string, workspaceId: string) {
  const [user, membership] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.membership.findUniqueOrThrow({ where: { userId_workspaceId: { userId, workspaceId } }, include: { workspace: true } }),
  ]);
  return { user: sanitizeUser(user), workspace: membership.workspace, role: membership.role };
}

export async function updateProfile(userId: string, input: { name?: string; avatarUrl?: string | null }) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
    },
  });
  return sanitizeUser(user);
}

export async function requestPasswordReset(input: ForgotPasswordInput) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Always behave the same way whether or not the account exists, so this
  // endpoint can't be used to enumerate registered emails.
  if (!user) {
    logger.info({ email: input.email }, "[auth] password reset requested for unknown email");
    return { sent: true };
  }

  const rawToken = randomBytes(32).toString("hex");

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });

  const resetUrl = `${env.WEB_APP_URL}/reset-password?token=${rawToken}`;
  const { subject, html, text } = resetPasswordEmailTemplate({ name: user.name, resetUrl });
  await sendMail({ to: user.email, subject, html, text });

  return { sent: true };
}

export async function resetPassword(input: ResetPasswordInput) {
  const tokenHash = hashToken(input.token);
  const stored = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
    throw new UnauthorizedError("This reset link is invalid or has expired");
  }

  const passwordHash = await hashPassword(input.password);

  await prisma.$transaction([
    prisma.user.update({ where: { id: stored.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } }),
    // Reset ends every existing session — anyone who had the old password (or
    // a stolen refresh token) shouldn't stay signed in past this point.
    prisma.refreshToken.updateMany({ where: { userId: stored.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);

  return { success: true };
}

function sanitizeUser<T extends { passwordHash?: string | null }>(user: T) {
  const { passwordHash, ...rest } = user;
  return rest;
}
