import jwt from "jsonwebtoken";
import { env } from "@/config/env";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface ServiceAccountCredentials {
  email: string;
  privateKey: string;
}

const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

/**
 * Exchanges Google service-account credentials for a short-lived OAuth
 * access token via the JWT bearer flow (RFC 7523), scoped per-caller (e.g.
 * Sheets vs Calendar need different scopes). Cached per (scope + account)
 * until ~30s before expiry.
 *
 * `credentials` lets a workspace's own service account (connected via
 * Settings) be used instead of the deployment-wide env one — pass it
 * explicitly, or omit to use GOOGLE_SERVICE_ACCOUNT_EMAIL/_PRIVATE_KEY.
 */
export async function getGoogleServiceAccountToken(scope: string, credentials?: ServiceAccountCredentials): Promise<string> {
  const email = credentials?.email || env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = credentials?.privateKey || env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  if (!email || !privateKey) {
    throw new Error("Google service account not configured (connect one in Settings, or set GOOGLE_SERVICE_ACCOUNT_EMAIL / _PRIVATE_KEY)");
  }

  const cacheKey = `${email}:${scope}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.accessToken;
  }

  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: email,
      scope,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    },
    privateKey.replace(/\\n/g, "\n"),
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
  tokenCache.set(cacheKey, { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}
