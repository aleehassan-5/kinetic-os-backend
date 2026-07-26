import { createHmac, timingSafeEqual } from "crypto";
import { env } from "@/config/env";

export function isCalendlyConfigured(): boolean {
  return Boolean(env.CALENDLY_ACCESS_TOKEN && env.CALENDLY_EVENT_TYPE_URI);
}

/**
 * Creates a real single-use Calendly scheduling link for the configured
 * event type. `leadId` is embedded as UTM tracking so the webhook handler
 * can match the resulting booking back to the right lead without relying
 * on email matching alone.
 */
export async function createSchedulingLink(leadId: string): Promise<string> {
  if (!isCalendlyConfigured()) {
    throw new Error("Calendly not configured (CALENDLY_ACCESS_TOKEN / CALENDLY_EVENT_TYPE_URI)");
  }

  const res = await fetch("https://api.calendly.com/scheduling_links", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CALENDLY_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      max_event_count: 1,
      owner: env.CALENDLY_EVENT_TYPE_URI,
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

/**
 * Verifies the `Calendly-Webhook-Signature` header (t=<timestamp>,v1=<hmac>)
 * against the raw request body using the webhook subscription's signing key.
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
