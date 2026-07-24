import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { NotFoundError, ConflictError } from "@/lib/errors";
import { createNotification } from "@/modules/notifications/notifications.service";
import { sendMail, inviteEmailTemplate } from "@/lib/mailer";
import type { MembershipRole } from "@prisma/client";

export async function listMembers(workspaceId: string) {
  return prisma.membership.findMany({
    where: { workspaceId },
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    orderBy: { invitedAt: "asc" },
  });
}

export async function inviteMember(workspaceId: string, email: string, role: MembershipRole, inviterUserId?: string) {
  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    // Placeholder account until the invite is accepted and a password is set.
    user = await prisma.user.create({
      data: { email, name: email.split("@")[0], passwordHash: "" },
    });
  }

  const existing = await prisma.membership.findUnique({ where: { userId_workspaceId: { userId: user.id, workspaceId } } });
  if (existing) throw new ConflictError("This person is already a member of the workspace");

  const membership = await prisma.membership.create({
    data: { userId: user.id, workspaceId, role, status: "PENDING" },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  const [workspace, inviter] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
    inviterUserId ? prisma.user.findUnique({ where: { id: inviterUserId } }) : Promise.resolve(null),
  ]);

  const { subject, html, text } = inviteEmailTemplate({
    workspaceName: workspace.name,
    inviterName: inviter?.name ?? "A teammate",
    role,
    signupUrl: `${env.WEB_APP_URL}/signup?invite=${membership.id}`,
  });
  await sendMail({ to: email, subject, html, text });

  await createNotification(workspaceId, {
    type: "TEAM",
    title: "Invite sent",
    description: `Invited ${email} to join as ${role.toLowerCase()}.`,
  });

  return membership;
}

export async function updateMemberRole(workspaceId: string, membershipId: string, role: MembershipRole) {
  const membership = await prisma.membership.findFirst({ where: { id: membershipId, workspaceId } });
  if (!membership) throw new NotFoundError("Member not found");
  return prisma.membership.update({ where: { id: membershipId }, data: { role } });
}

export async function removeMember(workspaceId: string, membershipId: string) {
  const membership = await prisma.membership.findFirst({ where: { id: membershipId, workspaceId } });
  if (!membership) throw new NotFoundError("Member not found");
  await prisma.membership.delete({ where: { id: membershipId } });
}
