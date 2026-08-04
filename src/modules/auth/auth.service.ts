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

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

async function issueTokenPair(userId: string, workspaceId: string, role: string, isSuperAdmin = false) {
  const accessToken = signAccessToken({ userId, workspaceId, role, isSuperAdmin });
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
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new ConflictError("An account with this email already exists");

  const passwordHash = await hashPassword(input.password);

  // No workspace, no membership, no tokens yet — those only come into
  // existence once a super_admin approves this account. The client_admin
  // exists as a user from the start so the approval step can find and
  // attach them to their workspace's OWNER membership.
  const account = await prisma.account.create({
    data: {
      businessName: input.businessName,
      ownerEmail: input.email,
      niche: input.niche,
      phone: input.phone,
      status: "PENDING",
      users: {
        create: { name: input.name, email: input.email, passwordHash },
      },
    },
  });

  return {
    status: "pending" as const,
    message: "Thanks! Your account is under review — we'll email you once it's approved.",
    accountId: account.id,
  };
}

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: {
      account: true,
      memberships: { where: { status: "ACTIVE" }, orderBy: { joinedAt: "asc" }, take: 1 },
    },
  });
  if (!user) throw new UnauthorizedError("Invalid email or password");
  if (!user.passwordHash) {
    throw new UnauthorizedError("This account uses Google sign-in. Continue with Google instead.");
  }

  const valid = await comparePassword(input.password, user.passwordHash);
  if (!valid) throw new UnauthorizedError("Invalid email or password");

  // Credentials are confirmed correct at this point — from here on it's
  // safe to give a specific, honest reason for why login is blocked,
  // since we're no longer at risk of confirming account existence to
  // someone who doesn't already have the right password.
  if (user.isSuperAdmin) {
    const tokens = await issueTokenPair(user.id, "", "SUPER_ADMIN", true);
    return { user: sanitizeUser(user), ...tokens };
  }

  if (!user.account || user.account.status === "PENDING") {
    throw new ForbiddenError("Your account is still awaiting approval. We'll email you once it's reviewed.");
  }
  if (user.account.status === "REJECTED") {
    throw new ForbiddenError(
      user.account.rejectionReason
        ? `Your account application wasn't approved: ${user.account.rejectionReason}`
        : "Your account application wasn't approved."
    );
  }
  if (user.account.status === "SUSPENDED") {
    throw new ForbiddenError("Your account has been suspended. Contact support for help.");
  }

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

  const user = await prisma.user.findUnique({ where: { id: payload.userId }, include: { account: true } });
  if (!user) throw new UnauthorizedError("Account no longer exists");

  // Rotate: revoke the used token, issue a new pair.
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });

  if (user.isSuperAdmin) {
    return issueTokenPair(user.id, "", "SUPER_ADMIN", true);
  }

  if (!user.account || user.account.status !== "ACTIVE") {
    throw new ForbiddenError("Your account no longer has access.");
  }

  const membership = await prisma.membership.findFirst({
    where: { userId: payload.userId, status: "ACTIVE" },
    orderBy: { joinedAt: "asc" },
  });
  if (!membership) throw new UnauthorizedError("No active workspace for this user");

  return issueTokenPair(payload.userId, membership.workspaceId, membership.role);
}

export async function loginWithGoogle(profile: GoogleProfile) {
  // 1) Already linked to this Google account — sign them in directly.
  let user = await prisma.user.findUnique({
    where: { googleId: profile.googleId },
    include: { account: true, memberships: { where: { status: "ACTIVE" }, orderBy: { joinedAt: "asc" }, take: 1 } },
  });

  // 2) An email/password account with the same email exists — link Google to it
  //    instead of creating a duplicate account for the same person.
  if (!user) {
    const existingByEmail = await prisma.user.findUnique({
      where: { email: profile.email },
      include: { account: true, memberships: { where: { status: "ACTIVE" }, orderBy: { joinedAt: "asc" }, take: 1 } },
    });
    if (existingByEmail) {
      user = await prisma.user.update({
        where: { id: existingByEmail.id },
        data: { googleId: profile.googleId, avatarUrl: existingByEmail.avatarUrl ?? profile.avatarUrl },
        include: { account: true, memberships: { where: { status: "ACTIVE" }, orderBy: { joinedAt: "asc" }, take: 1 } },
      });
    }
  }

  // 3) Brand new person — same as email signup, this creates a PENDING
  //    Account with no workspace yet. Google sign-in doesn't collect a
  //    business name, so we use a placeholder the person can rename once
  //    approved; the approval gate applies here exactly like it does for
  //    email/password signups — there's no bypass via Google.
  if (!user) {
    await prisma.account.create({
      data: {
        businessName: `${profile.name}'s Business`,
        ownerEmail: profile.email,
        status: "PENDING",
        users: {
          create: { name: profile.name, email: profile.email, googleId: profile.googleId, avatarUrl: profile.avatarUrl },
        },
      },
    });
    return { pending: true as const };
  }

  if (user.isSuperAdmin) {
    const tokens = await issueTokenPair(user.id, "", "SUPER_ADMIN", true);
    return { pending: false as const, user: sanitizeUser(user), ...tokens };
  }

  if (!user.account || user.account.status === "PENDING") {
    return { pending: true as const };
  }
  if (user.account.status === "REJECTED") {
    throw new ForbiddenError("Your account application wasn't approved.");
  }
  if (user.account.status === "SUSPENDED") {
    throw new ForbiddenError("Your account has been suspended. Contact support for help.");
  }

  const membership = user.memberships[0];
  if (!membership) throw new UnauthorizedError("This account has no active workspace");

  await prisma.membership.update({ where: { id: membership.id }, data: { lastActiveAt: new Date() } });

  const tokens = await issueTokenPair(user.id, membership.workspaceId, membership.role);
  return { pending: false as const, user: sanitizeUser(user), ...tokens };
}

export async function logout(refreshTokenRaw: string) {
  const tokenHash = hashToken(refreshTokenRaw);
  await prisma.refreshToken.updateMany({ where: { tokenHash }, data: { revokedAt: new Date() } });
}

export async function me(userId: string, workspaceId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  if (user.isSuperAdmin) {
    return { user: sanitizeUser(user), workspace: null, role: "SUPER_ADMIN" as const, isSuperAdmin: true };
  }

  const membership = await prisma.membership.findUniqueOrThrow({
    where: { userId_workspaceId: { userId, workspaceId } },
    include: { workspace: true },
  });
  return { user: sanitizeUser(user), workspace: membership.workspace, role: membership.role, isSuperAdmin: false };
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
