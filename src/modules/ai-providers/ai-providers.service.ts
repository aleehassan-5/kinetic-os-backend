import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { encryptJson, decryptJson } from "@/lib/crypto";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import { AppError, NotFoundError } from "@/lib/errors";
import type { IntegrationType } from "@prisma/client";
import type { AiProvider, ConnectAiProviderInput } from "./ai-providers.schema";

export interface TestKeyResult {
  valid: boolean;
  detail: string;
}

interface AiCredentials {
  apiKey: string;
}

/** Live-checks the key against the provider's own API before we ever save it as connected. */
export async function testProviderKey(provider: AiProvider, apiKey: string): Promise<TestKeyResult> {
  try {
    switch (provider) {
      case "OPENAI": {
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) return { valid: false, detail: await openAiErrorDetail(res) };
        return { valid: true, detail: "Verified — key can call the OpenAI API" };
      }
      case "ANTHROPIC": {
        const res = await fetch("https://api.anthropic.com/v1/models", {
          headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        });
        if (!res.ok) return { valid: false, detail: await anthropicErrorDetail(res) };
        return { valid: true, detail: "Verified — key can call the Anthropic API" };
      }
      case "ELEVENLABS": {
        const res = await fetch("https://api.elevenlabs.io/v1/user", {
          headers: { "xi-api-key": apiKey },
        });
        if (!res.ok) return { valid: false, detail: `ElevenLabs rejected this key (HTTP ${res.status})` };
        return { valid: true, detail: "Verified — key can call the ElevenLabs API" };
      }
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message, provider }, "[ai-providers] connection test failed");
    return { valid: false, detail: "Couldn't reach the provider to verify — check your internet connection and try again" };
  }
}

async function openAiErrorDetail(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: { message?: string } };
    return data.error?.message ?? `OpenAI rejected this key (HTTP ${res.status})`;
  } catch {
    return `OpenAI rejected this key (HTTP ${res.status})`;
  }
}

async function anthropicErrorDetail(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: { message?: string } };
    return data.error?.message ?? `Anthropic rejected this key (HTTP ${res.status})`;
  } catch {
    return `Anthropic rejected this key (HTTP ${res.status})`;
  }
}

const ENV_CONFIGURED: Record<AiProvider, boolean> = {
  OPENAI: !!env.OPENAI_API_KEY,
  ANTHROPIC: !!env.ANTHROPIC_API_KEY,
  ELEVENLABS: !!env.ELEVENLABS_API_KEY,
};

export async function listAiProviders(workspaceId: string) {
  const rows = await prisma.integration.findMany({
    where: { workspaceId, type: { in: ["OPENAI", "ANTHROPIC", "ELEVENLABS"] } },
  });

  const providers: AiProvider[] = ["OPENAI", "ANTHROPIC", "ELEVENLABS"];
  return providers.map((provider) => {
    const row = rows.find((r) => r.type === provider);
    return {
      provider,
      status: row?.status ?? "NOT_CONNECTED",
      detail: row?.detail ?? null,
      updatedAt: row?.updatedAt ?? null,
      // Lets the Settings UI show "using deployment default" instead of a
      // bare "not connected" when a fallback env key is already configured.
      fallbackConfigured: ENV_CONFIGURED[provider],
    };
  });
}

export async function connectAiProvider(workspaceId: string, input: ConnectAiProviderInput) {
  const testResult = await testProviderKey(input.provider, input.apiKey);
  if (!testResult.valid) {
    throw new AppError(`Couldn't verify this key: ${testResult.detail}`, 422);
  }

  const credentials: AiCredentials = { apiKey: input.apiKey };

  const integration = await prisma.integration.upsert({
    where: { workspaceId_type: { workspaceId, type: input.provider as IntegrationType } },
    update: { status: "CONNECTED", detail: testResult.detail, credentials: encryptJson(credentials) },
    create: {
      workspaceId,
      type: input.provider as IntegrationType,
      status: "CONNECTED",
      detail: testResult.detail,
      credentials: encryptJson(credentials),
    },
  });

  return { provider: input.provider, status: integration.status, detail: integration.detail };
}

export async function disconnectAiProvider(workspaceId: string, provider: AiProvider) {
  const integration = await prisma.integration.findUnique({
    where: { workspaceId_type: { workspaceId, type: provider as IntegrationType } },
  });
  if (!integration) throw new NotFoundError("This provider isn't connected");

  await prisma.integration.update({
    where: { id: integration.id },
    data: { status: "NOT_CONNECTED", credentials: Prisma.JsonNull, detail: null },
  });

  return { disconnected: true };
}

/**
 * Resolves the API key to use for a given provider and workspace: the
 * workspace's own key if they've connected one in Settings → AI Providers,
 * otherwise the deployment-wide key from env (if the person who set up this
 * instance configured one). Returns null if neither is available, so callers
 * can fall back to a "demo mode" response instead of throwing.
 */
export async function resolveAiKey(workspaceId: string, provider: AiProvider): Promise<string | null> {
  const integration = await prisma.integration.findUnique({
    where: { workspaceId_type: { workspaceId, type: provider as IntegrationType } },
  });

  if (integration?.status === "CONNECTED" && integration.credentials) {
    try {
      const creds = decryptJson<AiCredentials>(integration.credentials as unknown as string);
      if (creds.apiKey) return creds.apiKey;
    } catch (err) {
      logger.warn({ err: (err as Error).message, workspaceId, provider }, "[ai-providers] failed to decrypt stored key — falling back to env");
    }
  }

  switch (provider) {
    case "OPENAI":
      return env.OPENAI_API_KEY || null;
    case "ANTHROPIC":
      return env.ANTHROPIC_API_KEY || null;
    case "ELEVENLABS":
      return env.ELEVENLABS_API_KEY || null;
  }
}
