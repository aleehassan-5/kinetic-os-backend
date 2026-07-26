import { prisma } from "@/lib/prisma";

export async function listMeetings(workspaceId: string) {
  return prisma.meeting.findMany({
    where: { lead: { workspaceId } },
    include: { lead: { select: { id: true, name: true, email: true, channel: true } } },
    orderBy: { startTime: "desc" },
    take: 100,
  });
}
