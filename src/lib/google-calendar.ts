import { env } from "@/config/env";
import { getGoogleServiceAccountToken } from "@/lib/google-service-account";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

export function isGoogleCalendarConfigured(): boolean {
  return Boolean(env.GOOGLE_CALENDAR_ID && env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
}

export interface CreateCalendarEventInput {
  summary: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  attendeeEmail?: string | null;
}

export interface CreateCalendarEventResult {
  eventId: string;
  htmlLink: string;
}

/**
 * Creates a real event on the configured Google Calendar. The calendar
 * (GOOGLE_CALENDAR_ID) must be shared with the service account email as an
 * editor — standard one-time setup, no per-lead OAuth needed.
 */
export async function createCalendarEvent(input: CreateCalendarEventInput): Promise<CreateCalendarEventResult> {
  if (!isGoogleCalendarConfigured()) {
    throw new Error("Google Calendar not configured (GOOGLE_CALENDAR_ID / service account)");
  }

  const accessToken = await getGoogleServiceAccountToken(CALENDAR_SCOPE);
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.GOOGLE_CALENDAR_ID)}/events?sendUpdates=all`;

  const body = {
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.startTime.toISOString() },
    end: { dateTime: input.endTime.toISOString() },
    attendees: input.attendeeEmail ? [{ email: input.attendeeEmail }] : undefined,
  };

  let res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // Plain service accounts (no domain-wide delegation) are not allowed to
  // invite attendees — Google returns a 403 specifically for that. Retry
  // once without attendees rather than losing the booking entirely; the
  // lead still gets the event link via the reply message.
  if (res.status === 403 && input.attendeeEmail) {
    const errText = await res.text();
    if (errText.includes("Service accounts cannot invite attendees")) {
      res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, attendees: undefined }),
      });
    } else {
      throw new Error(`Google Calendar event creation failed (403): ${errText}`);
    }
  }

  if (!res.ok) {
    throw new Error(`Google Calendar event creation failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as { id: string; htmlLink: string };
  return { eventId: data.id, htmlLink: data.htmlLink };
}
