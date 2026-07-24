import { env } from "@/config/env";
import { AppError } from "@/lib/errors";

const BASE_URL = "https://api.lemonsqueezy.com/v1";

function assertConfigured() {
  if (!env.LEMONSQUEEZY_API_KEY || !env.LEMONSQUEEZY_STORE_ID) {
    throw new AppError(
      "Lemon Squeezy is not configured — set LEMONSQUEEZY_API_KEY and LEMONSQUEEZY_STORE_ID",
      503
    );
  }
}

async function lemonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  assertConfigured();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
      Authorization: `Bearer ${env.LEMONSQUEEZY_API_KEY}`,
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new AppError(`Lemon Squeezy API error (${res.status})`, 502, body);
  }

  return res.json() as Promise<T>;
}

interface CheckoutResponse {
  data: { attributes: { url: string } };
}

/**
 * Creates a hosted Lemon Squeezy checkout for a given variant (plan), tagging
 * it with our workspaceId so the webhook can attribute the resulting
 * subscription back to the right workspace via `custom_data`.
 */
export async function createCheckout(input: {
  variantId: string;
  workspaceId: string;
  email: string;
  name?: string;
}) {
  const payload = {
    data: {
      type: "checkouts",
      attributes: {
        checkout_data: {
          email: input.email,
          name: input.name,
          custom: { workspace_id: input.workspaceId },
        },
        product_options: {
          redirect_url: `${env.WEB_APP_URL}/billing?checkout=success`,
        },
      },
      relationships: {
        store: { data: { type: "stores", id: env.LEMONSQUEEZY_STORE_ID } },
        variant: { data: { type: "variants", id: input.variantId } },
      },
    },
  };

  const result = await lemonRequest<CheckoutResponse>("/checkouts", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return result.data.attributes.url;
}

interface SubscriptionResponse {
  data: {
    id: string;
    attributes: {
      status: string;
      renews_at: string | null;
      ends_at: string | null;
      trial_ends_at: string | null;
      card_brand: string | null;
      card_last_four: string | null;
      urls: { update_payment_method: string; customer_portal?: string };
    };
  };
}

export async function getSubscription(subscriptionId: string) {
  return lemonRequest<SubscriptionResponse>(`/subscriptions/${subscriptionId}`);
}

export async function cancelSubscription(subscriptionId: string) {
  return lemonRequest(`/subscriptions/${subscriptionId}`, { method: "DELETE" });
}
