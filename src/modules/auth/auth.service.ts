import { prisma } from "@/lib/prisma";
import { hashPassword, comparePassword, hashToken } from "@/lib/password";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "@/lib/jwt";
import { ConflictError, UnauthorizedError } from "@/lib/errors";
import type { LoginInput, RegisterInput } from "./auth.schema";
import type { Prisma } from "@prisma/client";

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

function sanitizeUser<T extends { passwordHash: string }>(user: T) {
  const { passwordHash, ...rest } = user;
  return rest;
}
