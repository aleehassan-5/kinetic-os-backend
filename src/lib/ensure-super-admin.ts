import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { logger } from "@/lib/logger";

/**
 * Guarantees a super admin login always exists, without needing anyone to
 * manually run `npm run seed` (e.g. via Render Shell) after a deploy.
 * Runs once at server boot — cheap upsert, safe to run on every restart.
 *
 * Email/password come from env vars so they aren't hardcoded in the repo;
 * falls back to a fixed default only if the env vars aren't set, purely so
 * local/dev setups still work out of the box.
 */
export async function ensureSuperAdmin() {
  const email = process.env.SUPER_ADMIN_EMAIL || "super@kineticos.app";
  const password = process.env.SUPER_ADMIN_PASSWORD || "ALLAH.pk87";

  const passwordHash = await hashPassword(password);

  await prisma.user.upsert({
    where: { email },
    update: { isSuperAdmin: true, passwordHash },
    create: { email, name: "Platform Admin", passwordHash, isSuperAdmin: true },
  });

  logger.info({ email }, "Super admin account ensured");
}
