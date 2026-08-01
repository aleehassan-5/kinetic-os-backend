import { createHmac, timingSafeEqual } from "crypto";
import { env } from "@/config/env";
import { resolveCalendlyCredentials } from "@/modules/scheduling-crm/scheduling-crm.service";

/**
 * Creates a real single-use Calendly scheduling link for the workspace's
 * connected event type (Settings → Scheduling, falls back to the
 * deployment-wide CALENDLY_* env vars if the workspace hasn't connected its
 * own). `leadId` is embedded as UTM tracking so the webhook handler can
 * match the resulting booking back to the right lead without relying on
 * email matching alone.
 */
export async function createSchedulingLink(workspaceId: string, leadId: string): Promise<string> {
  const creds = await resolveCalendlyCredentials(workspaceId);
  if (!creds) {
    throw new Error("Calendly not connected for this workspace — connect it in Settings → Scheduling");
  }

  const res = await fetch("https://api.calendly.com/scheduling_links", {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      max_event_count: 1,
      owner: creds.eventTypeUri,
      owner_type: "EventType",
    }),
  });

  if (!res.ok) {
    throw new Error(`Calendly scheduling link creation failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as { resource: { booking_url: string } };
  // utm_content carries the leadId through Calendly's booking flow and back
  // out in the invitee.created webhook payload under tracking.utm_content.
  const url = new URL(data.resource.booking_url);
  url.searchParams.set("utm_content", leadId);
  return url.toString();
}

export async function isCalendlyConnected(workspaceId: string): Promise<boolean> {
  return (await resolveCalendlyCredentials(workspaceId)) !== null;
}

/**
 * Verifies the `Calendly-Webhook-Signature` header (t=<timestamp>,v1=<hmac>)
 * against the raw request body using the webhook subscription's signing key.
 * This is deployment-level (one webhook endpoint receives events for every
 * workspace's Calendly connection), so it still reads from env.
 */
export function verifyCalendlyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean {
  if (!env.CALENDLY_WEBHOOK_SIGNING_KEY) return true; // no key configured — skip verification (dev mode)
  if (!signatureHeader) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k, v];
    })
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const expected = createHmac("sha256", env.CALENDLY_WEBHOOK_SIGNING_KEY)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
