import jwt from "jsonwebtoken";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

/**
 * Exchanges the Google service-account credentials for a short-lived OAuth
 * access token via the JWT bearer flow (RFC 7523) — signed locally with
 * `jsonwebtoken`, so no extra `googleapis`/`google-auth-library` dependency
 * is required just for this one call.
 */
async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.accessToken;
  }

  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      scope: SHEETS_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    },
    env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, "\n"),
    { algorithm: "RS256" }
  );

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!res.ok) {
    throw new Error(`Google OAuth token exchange failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

/** Appends a single row to the configured spreadsheet's first sheet (tab "Sheet1" by default). */
export async function appendRow(values: (string | number | null)[], sheetName = "Sheet1"): Promise<void> {
  if (!env.GOOGLE_SHEETS_SPREADSHEET_ID || !env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    logger.warn({ values }, "[google-sheets] not configured — logging instead of appending");
    return;
  }

  const accessToken = await getAccessToken();
  const range = `${sheetName}!A1`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEETS_SPREADSHEET_ID}/values/${encodeURIComponent(
    range
  )}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [values] }),
  });

  if (!res.ok) {
    throw new Error(`Google Sheets append failed (${res.status}): ${await res.text()}`);
  }
}
