import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { encryptJson, decryptJson } from "@/lib/crypto";
import { getGoogleServiceAccountToken } from "@/lib/google-service-account";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import { AppError, NotFoundError } from "@/lib/errors";
import type { IntegrationType } from "@prisma/client";
import { parseServiceAccountJson, type ConnectSchedulingCrmInput, type SchedulingCrmType } from "./scheduling-crm.schema";

export interface TestResult {
  valid: boolean;
  detail: string;
}

export async function testSchedulingCrm(input: ConnectSchedulingCrmInput): Promise<TestResult> {
  try {
    switch (input.type) {
      case "CALENDLY": {
        const res = await fetch("https://api.calendly.com/users/me", {
          headers: { Authorization: `Bearer ${input.accessToken}` },
        });
        if (!res.ok) return { valid: false, detail: `Calendly rejected this token (HTTP ${res.status})` };
        const data = (await res.json()) as { resource?: { name?: string } };
        return { valid: true, detail: `Verified — signed in as ${data.resource?.name ?? "Calendly account"}` };
      }
      case "HUBSPOT": {
        const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts?limit=1", {
          headers: { Authorization: `Bearer ${input.accessToken}` },
        });
        if (!res.ok) return { valid: false, detail: `HubSpot rejected this token (HTTP ${res.status})` };
        return { valid: true, detail: "Verified — can read/write HubSpot contacts" };
      }
      case "GOOGLE_CALENDAR": {
        const account = parseServiceAccountJson(input.serviceAccountJson);
        const token = await getGoogleServiceAccountToken("https://www.googleapis.com/auth/calendar", {
          email: account.client_email,
          privateKey: account.private_key,
        });
        const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          return {
            valid: false,
            detail: `Google rejected this (HTTP ${res.status}) — make sure the calendar is shared with ${account.client_email} as an editor`,
          };
        }
        const data = (await res.json()) as { summary?: string };
        return { valid: true, detail: `Verified — connected to calendar "${data.summary ?? input.calendarId}"` };
      }
      case "GOOGLE_SHEETS": {
        const account = parseServiceAccountJson(input.serviceAccountJson);
        const token = await getGoogleServiceAccountToken("https://www.googleapis.com/auth/spreadsheets", {
          email: account.client_email,
          privateKey: account.private_key,
        });
        const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${input.spreadsheetId}?fields=properties.title`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          return {
            valid: false,
            detail: `Google rejected this (HTTP ${res.status}) — make sure the sheet is shared with ${account.client_email} as an editor`,
          };
        }
        const data = (await res.json()) as { properties?: { title?: string } };
        return { valid: true, detail: `Verified — connected to spreadsheet "${data.properties?.title ?? input.spreadsheetId}"` };
      }
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message, type: input.type }, "[scheduling-crm] connection test failed");
    return { valid: false, detail: (err as Error).message || "Couldn't verify these credentials — check them and try again" };
  }
}

function isEnvFallbackConfigured(type: SchedulingCrmType): boolean {
  switch (type) {
    case "CALENDLY":
      return !!(env.CALENDLY_ACCESS_TOKEN && env.CALENDLY_EVENT_TYPE_URI);
    case "HUBSPOT":
      return !!env.HUBSPOT_ACCESS_TOKEN;
    case "GOOGLE_CALENDAR":
      return !!(env.GOOGLE_CALENDAR_ID && env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
    case "GOOGLE_SHEETS":
      return !!(env.GOOGLE_SHEETS_SPREADSHEET_ID && env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
  }
}

export async function listSchedulingCrm(workspaceId: string) {
  const rows = await prisma.integration.findMany({
    where: { workspaceId, type: { in: ["CALENDLY", "HUBSPOT", "GOOGLE_CALENDAR", "GOOGLE_SHEETS"] } },
  });
  const types: SchedulingCrmType[] = ["CALENDLY", "HUBSPOT", "GOOGLE_CALENDAR", "GOOGLE_SHEETS"];

  return types.map((type) => {
    const row = rows.find((r) => r.type === type);
    return {
      type,
      status: row?.status ?? "NOT_CONNECTED",
      detail: row?.detail ?? null,
      updatedAt: row?.updatedAt ?? null,
      fallbackConfigured: isEnvFallbackConfigured(type),
    };
  });
}

export async function connectSchedulingCrm(workspaceId: string, input: ConnectSchedulingCrmInput) {
  const testResult = await testSchedulingCrm(input);
  if (!testResult.valid) {
    throw new AppError(`Couldn't verify these credentials: ${testResult.detail}`, 422);
  }

  const { type, ...rest } = input;

  const integration = await prisma.integration.upsert({
    where: { workspaceId_type: { workspaceId, type: type as IntegrationType } },
    update: { status: "CONNECTED", detail: testResult.detail, credentials: encryptJson(rest) },
    create: { workspaceId, type: type as IntegrationType, status: "CONNECTED", detail: testResult.detail, credentials: encryptJson(rest) },
  });

  return { type, status: integration.status, detail: integration.detail };
}

export async function disconnectSchedulingCrm(workspaceId: string, type: SchedulingCrmType) {
  const integration = await prisma.integration.findUnique({ where: { workspaceId_type: { workspaceId, type: type as IntegrationType } } });
  if (!integration) throw new NotFoundError("This isn't connected");

  await prisma.integration.update({
    where: { id: integration.id },
    data: { status: "NOT_CONNECTED", credentials: Prisma.JsonNull, detail: null },
  });

  return { disconnected: true };
}

async function getIntegrationCredentials<T>(workspaceId: string, type: SchedulingCrmType): Promise<T | null> {
  const integration = await prisma.integration.findUnique({ where: { workspaceId_type: { workspaceId, type: type as IntegrationType } } });
  if (integration?.status !== "CONNECTED" || !integration.credentials) return null;
  try {
    return decryptJson<T>(integration.credentials as unknown as string);
  } catch (err) {
    logger.warn({ err: (err as Error).message, workspaceId, type }, "[scheduling-crm] failed to decrypt stored credentials — falling back to env");
    return null;
  }
}

export interface ResolvedCalendly {
  accessToken: string;
  eventTypeUri: string;
}

export async function resolveCalendlyCredentials(workspaceId: string): Promise<ResolvedCalendly | null> {
  const stored = await getIntegrationCredentials<{ accessToken: string; eventTypeUri: string }>(workspaceId, "CALENDLY");
  if (stored) return stored;
  if (env.CALENDLY_ACCESS_TOKEN && env.CALENDLY_EVENT_TYPE_URI) {
    return { accessToken: env.CALENDLY_ACCESS_TOKEN, eventTypeUri: env.CALENDLY_EVENT_TYPE_URI };
  }
  return null;
}

export async function resolveHubspotToken(workspaceId: string): Promise<string | null> {
  const stored = await getIntegrationCredentials<{ accessToken: string }>(workspaceId, "HUBSPOT");
  return stored?.accessToken || env.HUBSPOT_ACCESS_TOKEN || null;
}

export interface ResolvedGoogleServiceAccount {
  email: string;
  privateKey: string;
}

export async function resolveGoogleCalendar(workspaceId: string): Promise<{ account: ResolvedGoogleServiceAccount; calendarId: string } | null> {
  const stored = await getIntegrationCredentials<{ serviceAccountJson: string; calendarId: string }>(workspaceId, "GOOGLE_CALENDAR");
  if (stored) {
    const parsed = parseServiceAccountJson(stored.serviceAccountJson);
    return { account: { email: parsed.client_email, privateKey: parsed.private_key }, calendarId: stored.calendarId };
  }
  if (env.GOOGLE_CALENDAR_ID && env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    return {
      account: { email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, privateKey: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY },
      calendarId: env.GOOGLE_CALENDAR_ID,
    };
  }
  return null;
}

export async function resolveGoogleSheets(workspaceId: string): Promise<{ account: ResolvedGoogleServiceAccount; spreadsheetId: string } | null> {
  const stored = await getIntegrationCredentials<{ serviceAccountJson: string; spreadsheetId: string }>(workspaceId, "GOOGLE_SHEETS");
  if (stored) {
    const parsed = parseServiceAccountJson(stored.serviceAccountJson);
    return { account: { email: parsed.client_email, privateKey: parsed.private_key }, spreadsheetId: stored.spreadsheetId };
  }
  if (env.GOOGLE_SHEETS_SPREADSHEET_ID && env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    return {
      account: { email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, privateKey: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY },
      spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
    };
  }
  return null;
}
