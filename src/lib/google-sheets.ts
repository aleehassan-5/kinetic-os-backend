import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import { getGoogleServiceAccountToken } from "@/lib/google-service-account";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

/** Appends a single row to the configured spreadsheet's first sheet (tab "Sheet1" by default). */
export async function appendRow(values: (string | number | null)[], sheetName = "Sheet1"): Promise<void> {
  if (!env.GOOGLE_SHEETS_SPREADSHEET_ID || !env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    logger.warn({ values }, "[google-sheets] not configured — logging instead of appending");
    return;
  }

  const accessToken = await getGoogleServiceAccountToken(SHEETS_SCOPE);
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
