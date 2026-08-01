import { z } from "zod";

export const schedulingCrmTypeSchema = z.enum(["CALENDLY", "GOOGLE_CALENDAR", "HUBSPOT", "GOOGLE_SHEETS"]);

export const connectSchedulingCrmSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("CALENDLY"),
    accessToken: z.string().min(1),
    eventTypeUri: z.string().url(),
  }),
  z.object({
    type: z.literal("HUBSPOT"),
    accessToken: z.string().min(1),
  }),
  z.object({
    type: z.literal("GOOGLE_CALENDAR"),
    serviceAccountJson: z.string().min(1),
    calendarId: z.string().min(1),
  }),
  z.object({
    type: z.literal("GOOGLE_SHEETS"),
    serviceAccountJson: z.string().min(1),
    spreadsheetId: z.string().min(1),
  }),
]);

export type SchedulingCrmType = z.infer<typeof schedulingCrmTypeSchema>;
export type ConnectSchedulingCrmInput = z.infer<typeof connectSchedulingCrmSchema>;

export interface ParsedServiceAccount {
  client_email: string;
  private_key: string;
}

/** Google Cloud Console downloads service account credentials as one JSON file — parse the two fields we actually need. */
export function parseServiceAccountJson(raw: string): ParsedServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("That doesn't look like valid JSON. Paste the whole service account key file exactly as downloaded.");
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.client_email !== "string" || typeof obj.private_key !== "string") {
    throw new Error("This JSON is missing client_email or private_key — make sure it's a Google service account key file.");
  }
  return { client_email: obj.client_email, private_key: obj.private_key };
}
