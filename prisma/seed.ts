import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";

async function main() {
  const passwordHash = await hashPassword("password123");

  // ── Platform super_admin — the only way one ever gets created. Not
  // reachable through public signup, on purpose. ──────────────────────────
  const superAdmin = await prisma.user.upsert({
    where: { email: "super@kineticos.app" },
    update: { isSuperAdmin: true },
    create: { email: "super@kineticos.app", name: "Platform Admin", passwordHash, isSuperAdmin: true },
  });

  // ── One approved demo client account + workspace, so the rest of the app
  // (leads, workflows, content, etc.) still has something real to render. ──
  const account = await prisma.account.upsert({
    where: { id: "seed-account-moiz" },
    update: {},
    create: {
      id: "seed-account-moiz",
      businessName: "Moiz Real Estate",
      ownerEmail: "admin@kineticos.app",
      niche: "real_estate",
      phone: "+923001234567",
      status: "ACTIVE",
      approvedById: superAdmin.id,
      approvedAt: new Date(),
    },
  });

  const workspace = await prisma.workspace.upsert({
    where: { slug: "moiz-real-estate" },
    update: {},
    create: { accountId: account.id, name: "Moiz Real Estate", slug: "moiz-real-estate", industry: "real_estate" },
  });

  const user = await prisma.user.upsert({
    where: { email: "admin@kineticos.app" },
    update: { accountId: account.id },
    create: { email: "admin@kineticos.app", name: "Moiz", passwordHash, accountId: account.id },
  });

  await prisma.membership.upsert({
    where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
    update: {},
    create: { userId: user.id, workspaceId: workspace.id, role: "OWNER", status: "ACTIVE", joinedAt: new Date() },
  });

  // ── A second, still-PENDING account so the admin approval panel has
  // something real to show without any manual signup first. ──────────────
  await prisma.account.upsert({
    where: { id: "seed-account-pending-clinic" },
    update: {},
    create: {
      id: "seed-account-pending-clinic",
      businessName: "Al-Shifa Family Clinic",
      ownerEmail: "clinic-owner@example.com",
      niche: "clinic",
      phone: "+923009876543",
      status: "PENDING",
      users: {
        create: {
          email: "clinic-owner@example.com",
          name: "Dr. Ayesha Malik",
          passwordHash: await hashPassword("password123"),
        },
      },
    },
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
      title: "3 signs you're losing buyers before you even call them back",
      prompt: "Quick-hit reel about missed real-estate inquiries and how an always-on assistant fixes them.",
      caption: "3 signs you're losing buyers before you even call them back 🏡 #realestate #automation",
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
      title: "New listing — 3 bed family home",
      prompt: "Clean listing graphic for a 3-bedroom family home, highlighting price and a scheduling link.",
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

  console.log("✅ Seeded:", {
    superAdmin: { email: superAdmin.email, password: "password123" },
    activeClient: { workspace: workspace.slug, user: user.email, password: "password123" },
    pendingClient: { businessName: "Al-Shifa Family Clinic", user: "clinic-owner@example.com", password: "password123" },
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
