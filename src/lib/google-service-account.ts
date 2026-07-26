import jwt from "jsonwebtoken";
import { env } from "@/config/env";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

/**
 * Exchanges the Google service-account credentials for a short-lived OAuth
 * access token via the JWT bearer flow (RFC 7523), scoped per-caller (e.g.
 * Sheets vs Calendar need different scopes). Cached per scope until ~30s
 * before expiry.
 */
export async function getGoogleServiceAccountToken(scope: string): Promise<string> {
  const cached = tokenCache.get(scope);
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.accessToken;
  }

  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    throw new Error("Google service account not configured (GOOGLE_SERVICE_ACCOUNT_EMAIL / _PRIVATE_KEY)");
  }

  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      scope,
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
  tokenCache.set(scope, { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}
