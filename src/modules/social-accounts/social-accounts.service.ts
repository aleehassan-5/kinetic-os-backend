import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { encryptJson, decryptJson } from "@/lib/crypto";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import { AppError, NotFoundError } from "@/lib/errors";
import type { SocialPlatform } from "@prisma/client";
import type { ConnectSocialAccountInput, SocialPlatformId } from "./social-accounts.schema";

export interface TestResult {
  valid: boolean;
  detail: string;
}

async function metaErrorDetail(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: { message?: string } };
    return data.error?.message ?? `Meta API rejected this (HTTP ${res.status})`;
  } catch {
    return `Meta API rejected this (HTTP ${res.status})`;
  }
}

export async function testSocialAccount(input: ConnectSocialAccountInput): Promise<TestResult> {
  try {
    switch (input.platform) {
      case "INSTAGRAM": {
        const res = await fetch(
          `https://graph.facebook.com/v20.0/${input.igBusinessAccountId}?fields=username&access_token=${input.pageAccessToken}`
        );
        if (!res.ok) return { valid: false, detail: await metaErrorDetail(res) };
        const data = (await res.json()) as { username?: string };
        return { valid: true, detail: `Verified — will publish as @${data.username ?? input.igBusinessAccountId}` };
      }
      case "FACEBOOK": {
        const res = await fetch(`https://graph.facebook.com/v20.0/${input.pageId}?fields=name&access_token=${input.pageAccessToken}`);
        if (!res.ok) return { valid: false, detail: await metaErrorDetail(res) };
        const data = (await res.json()) as { name?: string };
        return { valid: true, detail: `Verified — will publish to "${data.name ?? input.pageId}"` };
      }
      case "TIKTOK": {
        const res = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=display_name", {
          headers: { Authorization: `Bearer ${input.accessToken}` },
        });
        if (!res.ok) return { valid: false, detail: `TikTok rejected this token (HTTP ${res.status})` };
        const data = (await res.json()) as { data?: { user?: { display_name?: string } } };
        return { valid: true, detail: `Verified — connected as ${data.data?.user?.display_name ?? "TikTok account"}` };
      }
      case "LINKEDIN": {
        const res = await fetch(`https://api.linkedin.com/v2/organizationAcls?q=roleAssignee&role=ADMINISTRATOR`, {
          headers: { Authorization: `Bearer ${input.accessToken}`, "X-Restli-Protocol-Version": "2.0.0" },
        });
        if (!res.ok) return { valid: false, detail: `LinkedIn rejected this token (HTTP ${res.status}) — check it has the w_organization_social scope` };
        return { valid: true, detail: `Verified — will publish as ${input.organizationUrn}` };
      }
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message, platform: input.platform }, "[social-accounts] connection test failed");
    return { valid: false, detail: "Couldn't reach the platform to verify — check your internet connection and try again" };
  }
}

function externalIdFor(input: ConnectSocialAccountInput): string {
  switch (input.platform) {
    case "INSTAGRAM":
      return input.igBusinessAccountId;
    case "FACEBOOK":
      return input.pageId;
    case "TIKTOK":
      return "tiktok-account"; // TikTok's API doesn't expose a stable open_id from this token alone
    case "LINKEDIN":
      return input.organizationUrn;
  }
}

function credentialsFor(input: ConnectSocialAccountInput): Record<string, string> {
  const { platform, ...rest } = input;
  return rest;
}

export async function listSocialAccounts(workspaceId: string) {
  const rows = await prisma.socialAccount.findMany({ where: { workspaceId } });
  const platforms: SocialPlatformId[] = ["INSTAGRAM", "FACEBOOK", "TIKTOK", "LINKEDIN"];

  return platforms.map((platform) => {
    const row = rows.find((r) => r.platform === platform);
    return {
      platform,
      status: row?.status ?? "NOT_CONNECTED",
      displayName: row?.displayName ?? null,
      autoReplyComments: row?.autoReplyComments ?? false,
      updatedAt: row?.updatedAt ?? null,
      fallbackConfigured: isEnvFallbackConfigured(platform),
    };
  });
}

function isEnvFallbackConfigured(platform: SocialPlatformId): boolean {
  switch (platform) {
    case "INSTAGRAM":
      return !!(env.META_PAGE_ACCESS_TOKEN && env.INSTAGRAM_BUSINESS_ACCOUNT_ID);
    case "FACEBOOK":
      return !!(env.META_PAGE_ACCESS_TOKEN && env.FACEBOOK_PAGE_ID);
    case "TIKTOK":
      return !!env.TIKTOK_ACCESS_TOKEN;
    case "LINKEDIN":
      return !!(env.LINKEDIN_ACCESS_TOKEN && env.LINKEDIN_ORGANIZATION_URN);
  }
}

export async function connectSocialAccount(workspaceId: string, input: ConnectSocialAccountInput) {
  const testResult = await testSocialAccount(input);
  if (!testResult.valid) {
    throw new AppError(`Couldn't verify these credentials: ${testResult.detail}`, 422);
  }

  const externalId = externalIdFor(input);
  const displayName = testResult.detail.split("— ")[1] ?? null;

  const account = await prisma.socialAccount.upsert({
    where: { workspaceId_platform: { workspaceId, platform: input.platform as SocialPlatform } },
    update: { status: "CONNECTED", externalId, displayName, credentials: encryptJson(credentialsFor(input)) },
    create: {
      workspaceId,
      platform: input.platform as SocialPlatform,
      status: "CONNECTED",
      externalId,
      displayName,
      credentials: encryptJson(credentialsFor(input)),
    },
  });

  return { platform: input.platform, status: account.status, displayName: account.displayName };
}

export async function disconnectSocialAccount(workspaceId: string, platform: SocialPlatformId) {
  const account = await prisma.socialAccount.findUnique({
    where: { workspaceId_platform: { workspaceId, platform: platform as SocialPlatform } },
  });
  if (!account) throw new NotFoundError("This account isn't connected");

  await prisma.socialAccount.update({
    where: { id: account.id },
    data: { status: "NOT_CONNECTED", credentials: Prisma.JsonNull, externalId: null, displayName: null },
  });

  return { disconnected: true };
}

export async function setAutoReply(workspaceId: string, platform: SocialPlatformId, enabled: boolean) {
  const account = await prisma.socialAccount.findUnique({
    where: { workspaceId_platform: { workspaceId, platform: platform as SocialPlatform } },
  });
  if (!account) throw new NotFoundError("This account isn't connected");

  await prisma.socialAccount.update({ where: { id: account.id }, data: { autoReplyComments: enabled } });
  return { autoReplyComments: enabled };
}

/** Decrypted credentials for a connected social account, used by publishers. Returns undefined if not connected (publishers then fall back to env). */
export function getStoredCredentials(account: { credentials: unknown } | null): Record<string, string> | undefined {
  if (!account?.credentials) return undefined;
  try {
    return decryptJson<Record<string, string>>(account.credentials as unknown as string);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "[social-accounts] failed to decrypt stored credentials — falling back to env");
    return undefined;
  }
}
