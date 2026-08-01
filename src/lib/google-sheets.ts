import { logger } from "@/lib/logger";
import { getGoogleServiceAccountToken } from "@/lib/google-service-account";
import { resolveGoogleSheets } from "@/modules/scheduling-crm/scheduling-crm.service";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

/**
 * Appends a single row to the workspace's connected spreadsheet's first
 * sheet (tab "Sheet1" by default). Falls back to the deployment-wide
 * GOOGLE_SHEETS_* env vars if the workspace hasn't connected its own.
 */
export async function appendRow(workspaceId: string, values: (string | number | null)[], sheetName = "Sheet1"): Promise<void> {
  const resolved = await resolveGoogleSheets(workspaceId);
  if (!resolved) {
    logger.warn({ values }, "[google-sheets] not connected for this workspace — logging instead of appending");
    return;
  }
  const { account, spreadsheetId } = resolved;

  const accessToken = await getGoogleServiceAccountToken(SHEETS_SCOPE, account);
  const range = `${sheetName}!A1`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
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
