import { prisma } from "@/lib/prisma";

export interface GlobalSearchResult {
  leads: { id: string; name: string | null; email: string | null; phone: string | null; channel: string; status: string }[];
  workflows: { id: string; name: string; status: string }[];
  documents: { id: string; title: string; sourceType: string; status: string }[];
}

const RESULTS_PER_CATEGORY = 5;

/**
 * Backs the topnav "Search leads, workflows, docs…" box. Runs a lightweight
 * case-insensitive `contains` match against each entity's user-facing
 * name/title fields (plus email/phone for leads) and returns a handful of
 * top matches per category — this is a quick-jump search, not a full-text
 * ranked search engine.
 */
export async function globalSearch(workspaceId: string, query: string): Promise<GlobalSearchResult> {
  const q = query.trim();
  if (q.length < 2) {
    return { leads: [], workflows: [], documents: [] };
  }

  const [leads, workflows, documents] = await Promise.all([
    prisma.lead.findMany({
      where: {
        workspaceId,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { phone: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, email: true, phone: true, channel: true, status: true },
      orderBy: { lastMessageAt: "desc" },
      take: RESULTS_PER_CATEGORY,
    }),
    prisma.workflow.findMany({
      where: { workspaceId, name: { contains: q, mode: "insensitive" } },
      select: { id: true, name: true, status: true },
      orderBy: { updatedAt: "desc" },
      take: RESULTS_PER_CATEGORY,
    }),
    prisma.knowledgeDocument.findMany({
      where: { workspaceId, title: { contains: q, mode: "insensitive" } },
      select: { id: true, title: true, sourceType: true, status: true },
      orderBy: { updatedAt: "desc" },
      take: RESULTS_PER_CATEGORY,
    }),
  ]);

  return { leads, workflows, documents };
}
