import { prisma } from "@/lib/prisma";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";

export async function updateWorkspace(
  workspaceId: string,
  userId: string,
  input: { name?: string; industry?: string; timezone?: string }
) {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
    throw new ForbiddenError("Only workspace owners and admins can update workspace settings");
  }

  return prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.industry !== undefined ? { industry: input.industry } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
    },
  });
}

/**
 * Remove the requesting user's own membership from a workspace.
 * The sole OWNER can't leave without transferring ownership first —
 * that would strand the workspace with no one able to manage it.
 */
export async function leaveWorkspace(workspaceId: string, userId: string) {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  if (!membership) throw new NotFoundError("You're not a member of this workspace");

  if (membership.role === "OWNER") {
    const otherOwners = await prisma.membership.count({
      where: { workspaceId, role: "OWNER", userId: { not: userId } },
    });
    if (otherOwners === 0) {
      throw new ConflictError("Transfer ownership to another member before leaving this workspace");
    }
  }

  await prisma.membership.delete({ where: { id: membership.id } });
}

/**
 * Permanently delete a workspace and everything under it (leads, workflows,
 * knowledge base, social content, billing records, etc). Only an OWNER may
 * do this — enforced by the route's requireRole guard as well, checked
 * again here since this is irreversible.
 */
export async function deleteWorkspace(workspaceId: string, userId: string) {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  if (!membership || membership.role !== "OWNER") {
    throw new ForbiddenError("Only a workspace owner can delete the workspace");
  }

  await prisma.workspace.delete({ where: { id: workspaceId } });
}
