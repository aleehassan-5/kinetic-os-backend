import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { logger } from "@/lib/logger";

/**
 * Guarantees a super admin login always exists, without needing anyone to
 * manually run `npm run seed` (e.g. via Render Shell) after a deploy.
 * Runs once at server boot — cheap upsert, safe to run on every restart.
 *
 * SECURITY: the real password must come from the SUPER_ADMIN_PASSWORD env
 * var (set it in Render → Environment, never in code). In production, if
 * that env var isn't set, we skip auto-provisioning entirely rather than
 * falling back to a guessable default — this repo is public, so anything
 * hardcoded here is effectively a public password.
 */
export async function ensureSuperAdmin() {
  const email = process.env.SUPER_ADMIN_EMAIL || "super@kineticos.app";
  const isProduction = process.env.NODE_ENV === "production";
  const password = process.env.SUPER_ADMIN_PASSWORD || (isProduction ? undefined : "password123");

  if (!password) {
    logger.warn(
      "SUPER_ADMIN_PASSWORD not set — skipping super admin auto-provision. Set it in your environment and redeploy."
    );
    return;
  }

  const passwordHash = await hashPassword(password);

  await prisma.user.upsert({
    where: { email },
    update: { isSuperAdmin: true, passwordHash },
    create: { email, name: "Platform Admin", passwordHash, isSuperAdmin: true },
  });

  logger.info({ email }, "Super admin account ensured");
}
