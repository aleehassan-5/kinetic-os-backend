import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";

async function main() {
  const passwordHash = await hashPassword("password123");

  const workspace = await prisma.workspace.upsert({
    where: { slug: "growth-workspace" },
    update: {},
    create: { name: "Growth workspace", slug: "growth-workspace", industry: "agency" },
  });

  const user = await prisma.user.upsert({
    where: { email: "are.khan@orbitai.agency" },
    update: {},
    create: { email: "are.khan@orbitai.agency", name: "Are Khan", passwordHash },
  });

  await prisma.membership.upsert({
    where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
    update: {},
    create: { userId: user.id, workspaceId: workspace.id, role: "OWNER", status: "ACTIVE", joinedAt: new Date() },
  });

  for (const type of ["WHATSAPP", "TELEGRAM", "INSTAGRAM", "MESSENGER", "EMAIL", "CALENDLY", "GOOGLE_CALENDAR", "HUBSPOT", "GOOGLE_SHEETS"] as const) {
    await prisma.integration.upsert({
      where: { workspaceId_type: { workspaceId: workspace.id, type } },
      update: {},
      create: { workspaceId: workspace.id, type, status: "NOT_CONNECTED" },
    });
  }

  for (const platform of ["INSTAGRAM", "FACEBOOK", "TIKTOK", "LINKEDIN"] as const) {
    await prisma.socialAccount.upsert({
      where: { workspaceId_platform: { workspaceId: workspace.id, platform } },
      update: {},
      create: { workspaceId: workspace.id, platform, status: "NOT_CONNECTED" },
    });
  }

  const igAccount = await prisma.socialAccount.findUniqueOrThrow({
    where: { workspaceId_platform: { workspaceId: workspace.id, platform: "INSTAGRAM" } },
  });
  const fbAccount = await prisma.socialAccount.findUniqueOrThrow({
    where: { workspaceId_platform: { workspaceId: workspace.id, platform: "FACEBOOK" } },
  });

  await prisma.socialPost.upsert({
    where: { id: "seed-post-reel-1" },
    update: {},
    create: {
      id: "seed-post-reel-1",
      workspaceId: workspace.id,
      accountId: igAccount.id,
      platform: "INSTAGRAM",
      contentType: "REEL",
      status: "SCHEDULED",
      title: "3 signs your funnel is leaking",
      prompt: "Quick-hit reel about common lead-funnel drop-off points and how automation fixes them.",
      caption: "3 signs your funnel is leaking 🚨 #automation #AI #leadgen",
      useVoiceover: true,
      scheduledAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.socialPost.upsert({
    where: { id: "seed-post-graphic-1" },
    update: {},
    create: {
      id: "seed-post-graphic-1",
      workspaceId: workspace.id,
      accountId: fbAccount.id,
      platform: "FACEBOOK",
      contentType: "STATIC_GRAPHIC",
      status: "DRAFT",
      title: "Client testimonial — Hamza Traders",
      prompt: "Testimonial graphic quoting a happy client about faster lead response times.",
    },
  });

  await prisma.workflow.upsert({
    where: { id: "seed-workflow-high-intent" },
    update: {},
    create: {
      id: "seed-workflow-high-intent",
      workspaceId: workspace.id,
      name: "Auto-reply on high intent",
      status: "ACTIVE",
      graph: {
        nodes: [
          { id: "t1", type: "trigger", data: { event: "intent_threshold", threshold: 80 } },
          { id: "c1", type: "condition", data: { field: "intentScore", operator: "gte", value: 80 } },
          { id: "a1", type: "action", data: { actionType: "ai_reply" } },
          { id: "a2", type: "action", data: { actionType: "notify", template: "A lead just crossed 80 intent score" } },
        ],
        edges: [
          { source: "t1", target: "c1" },
          { source: "c1", target: "a1", branch: "true" },
          { source: "c1", target: "a2", branch: "true" },
        ],
      },
    },
  });

  console.log("✅ Seeded:", { workspace: workspace.slug, user: user.email, password: "password123" });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
