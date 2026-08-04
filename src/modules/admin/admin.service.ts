import { prisma } from "@/lib/prisma";
import { NotFoundError, AppError } from "@/lib/errors";
import { slugify } from "@/lib/slugify";
import { sendMail, accountApprovedEmailTemplate, accountRejectedEmailTemplate, accountSuspendedEmailTemplate } from "@/lib/mailer";
import { createNotification } from "@/modules/notifications/notifications.service";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import type { AccountStatus, Prisma } from "@prisma/client";
import type { RejectAccountInput } from "./admin.schema";

const DEFAULT_INTEGRATION_TYPES = [
  "WHATSAPP", "TELEGRAM", "INSTAGRAM", "MESSENGER", "EMAIL", "CALENDLY", "GOOGLE_CALENDAR", "HUBSPOT", "GOOGLE_SHEETS",
] as const;
const DEFAULT_SOCIAL_PLATFORMS = ["INSTAGRAM", "FACEBOOK", "TIKTOK", "LINKEDIN"] as const;

export async function listAccounts(status?: AccountStatus) {
  return prisma.account.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    include: {
      users: { select: { id: true, name: true, email: true, createdAt: true } },
      workspace: { select: { id: true, name: true, planId: true } },
      approvedBy: { select: { id: true, name: true, email: true } },
    },
  });
}

export async function getAccountDetail(accountId: string) {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    include: {
      users: { select: { id: true, name: true, email: true, createdAt: true, isSuperAdmin: true } },
      workspace: true,
      approvedBy: { select: { id: true, name: true, email: true } },
    },
  });
  if (!account) throw new NotFoundError("Account not found");
  return account;
}

/**
 * Approves a PENDING account: creates its Workspace, promotes the
 * client_admin user to OWNER of it, seeds the default (disconnected)
 * integration rows, and emails them the good news. This is the one place
 * in the whole app a Workspace gets created — signup never creates one.
 */
export async function approveAccount(accountId: string, approvedById: string) {
  const account = await prisma.account.findUnique({ where: { id: accountId }, include: { users: true } });
  if (!account) throw new NotFoundError("Account not found");
  if (account.status !== "PENDING") {
    throw new AppError(`This account is ${account.status.toLowerCase()}, not pending — nothing to approve.`, 409);
  }

  const clientAdmin = account.users.find((u: { email: string }) => u.email === account.ownerEmail) ?? account.users[0];
  if (!clientAdmin) throw new AppError("This account has no user to promote to owner — data may be corrupted.", 500);

  const workspace = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const workspace = await tx.workspace.create({
      data: { accountId: account.id, name: account.businessName, slug: slugify(account.businessName), industry: account.niche ?? undefined },
    });

    await tx.membership.create({
      data: { userId: clientAdmin.id, workspaceId: workspace.id, role: "OWNER", status: "ACTIVE", joinedAt: new Date() },
    });

    await tx.integration.createMany({
      data: DEFAULT_INTEGRATION_TYPES.map((type) => ({ workspaceId: workspace.id, type, status: "NOT_CONNECTED" as const })),
    });
    await tx.socialAccount.createMany({
      data: DEFAULT_SOCIAL_PLATFORMS.map((platform) => ({ workspaceId: workspace.id, platform, status: "NOT_CONNECTED" as const })),
    });

    await tx.account.update({
      where: { id: account.id },
      data: { status: "ACTIVE", approvedById, approvedAt: new Date(), rejectionReason: null },
    });

    return workspace;
  });

  await createNotification(workspace.id, {
    type: "SYSTEM",
    title: "Welcome to Kinetic OS",
    description: "Your account is approved — connect a channel and add a few documents to your knowledge base to get started.",
  });

  const { subject, html, text } = accountApprovedEmailTemplate({
    name: clientAdmin.name,
    businessName: account.businessName,
    loginUrl: `${env.WEB_APP_URL}/login`,
  });
  const mailResult = await sendMail({ to: clientAdmin.email, subject, html, text });
  if (!mailResult.sent) {
    logger.warn({ accountId, email: clientAdmin.email }, "[admin] approval email not sent (no SMTP configured)");
  }

  return { accountId: account.id, workspaceId: workspace.id, status: "ACTIVE" as const };
}

export async function rejectAccount(accountId: string, approvedById: string, input: RejectAccountInput) {
  const account = await prisma.account.findUnique({ where: { id: accountId }, include: { users: true } });
  if (!account) throw new NotFoundError("Account not found");
  if (account.status !== "PENDING") {
    throw new AppError(`This account is ${account.status.toLowerCase()}, not pending — nothing to reject.`, 409);
  }

  await prisma.account.update({
    where: { id: account.id },
    data: { status: "REJECTED", approvedById, approvedAt: new Date(), rejectionReason: input.reason ?? null },
  });

  const clientAdmin = account.users.find((u: { email: string }) => u.email === account.ownerEmail) ?? account.users[0];
  if (clientAdmin) {
    const { subject, html, text } = accountRejectedEmailTemplate({
      name: clientAdmin.name,
      businessName: account.businessName,
      reason: input.reason,
    });
    await sendMail({ to: clientAdmin.email, subject, html, text });
  }

  return { accountId: account.id, status: "REJECTED" as const };
}

/** Suspends an ACTIVE account and immediately revokes every session so access stops without waiting for tokens to expire. */
export async function suspendAccount(accountId: string) {
  const account = await prisma.account.findUnique({ where: { id: accountId }, include: { users: true } });
  if (!account) throw new NotFoundError("Account not found");
  if (account.status !== "ACTIVE") {
    throw new AppError(`This account is ${account.status.toLowerCase()}, not active — nothing to suspend.`, 409);
  }

  const userIds = account.users.map((u: { id: string }) => u.id);
  await prisma.$transaction([
    prisma.account.update({ where: { id: account.id }, data: { status: "SUSPENDED" } }),
    prisma.refreshToken.updateMany({ where: { userId: { in: userIds }, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);

  const clientAdmin = account.users.find((u: { email: string }) => u.email === account.ownerEmail) ?? account.users[0];
  if (clientAdmin) {
    const { subject, html, text } = accountSuspendedEmailTemplate({ name: clientAdmin.name, businessName: account.businessName });
    await sendMail({ to: clientAdmin.email, subject, html, text });
  }

  return { accountId: account.id, status: "SUSPENDED" as const };
}

/** Lifts a suspension, restoring login access — paired action to suspendAccount, not in the original spec but the natural undo. */
export async function reactivateAccount(accountId: string) {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) throw new NotFoundError("Account not found");
  if (account.status !== "SUSPENDED") {
    throw new AppError(`This account is ${account.status.toLowerCase()}, not suspended — nothing to reactivate.`, 409);
  }

  await prisma.account.update({ where: { id: account.id }, data: { status: "ACTIVE" } });
  return { accountId: account.id, status: "ACTIVE" as const };
}
