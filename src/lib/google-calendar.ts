import { getGoogleServiceAccountToken } from "@/lib/google-service-account";
import { resolveGoogleCalendar } from "@/modules/scheduling-crm/scheduling-crm.service";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

export async function isGoogleCalendarConnected(workspaceId: string): Promise<boolean> {
  return (await resolveGoogleCalendar(workspaceId)) !== null;
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
 * Creates a real event on the workspace's connected Google Calendar
 * (Settings → Scheduling, falls back to the deployment-wide service account
 * if the workspace hasn't connected its own). The calendar must be shared
 * with the service account email as an editor — standard one-time setup,
 * no per-lead OAuth needed.
 */
export async function createCalendarEvent(workspaceId: string, input: CreateCalendarEventInput): Promise<CreateCalendarEventResult> {
  const resolved = await resolveGoogleCalendar(workspaceId);
  if (!resolved) {
    throw new Error("Google Calendar not connected for this workspace — connect it in Settings → Scheduling");
  }
  const { account, calendarId } = resolved;

  const accessToken = await getGoogleServiceAccountToken(CALENDAR_SCOPE, account);
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`;

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
