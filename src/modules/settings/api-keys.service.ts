import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/password";
import { NotFoundError } from "@/lib/errors";
import type { ApiKeyScope } from "@prisma/client";

function generateRawKey(): { raw: string; preview: string } {
  const secret = randomBytes(24).toString("base64url");
  const raw = `sk_live_${secret}`;
  const preview = `sk_live_${"•".repeat(12)}${raw.slice(-4)}`;
  return { raw, preview };
}

export async function listApiKeys(workspaceId: string) {
  return prisma.apiKey.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, keyPreview: true, scope: true, lastUsedAt: true, createdAt: true },
  });
}

/** Returns the raw key exactly once — only the hash and a masked preview are persisted. */
export async function createApiKey(workspaceId: string, name: string, scope: ApiKeyScope) {
  const { raw, preview } = generateRawKey();
  const key = await prisma.apiKey.create({
    data: { workspaceId, name, scope, keyHash: hashToken(raw), keyPreview: preview },
  });
  return { id: key.id, name: key.name, scope: key.scope, createdAt: key.createdAt, rawKey: raw };
}

export async function revokeApiKey(workspaceId: string, keyId: string) {
  const key = await prisma.apiKey.findFirst({ where: { id: keyId, workspaceId } });
  if (!key) throw new NotFoundError("API key not found");
  await prisma.apiKey.delete({ where: { id: keyId } });
}
