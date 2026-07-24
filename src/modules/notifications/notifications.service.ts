import { prisma } from "@/lib/prisma";
import type { NotificationType } from "@prisma/client";

export async function createNotification(
  workspaceId: string,
  input: { type: NotificationType; title: string; description: string; userId?: string }
) {
  return prisma.notification.create({
    data: {
      workspaceId,
      userId: input.userId,
      type: input.type,
      title: input.title,
      description: input.description,
    },
  });
}

export async function listNotifications(workspaceId: string, unreadOnly = false) {
  return prisma.notification.findMany({
    where: { workspaceId, ...(unreadOnly ? { read: false } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function markRead(workspaceId: string, notificationId: string) {
  return prisma.notification.updateMany({
    where: { id: notificationId, workspaceId },
    data: { read: true },
  });
}

export async function markAllRead(workspaceId: string) {
  return prisma.notification.updateMany({
    where: { workspaceId, read: false },
    data: { read: true },
  });
}
