import jwt from "jsonwebtoken";
import { env } from "@/config/env";
import { UnauthorizedError } from "@/lib/errors";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

/** A short-lived, signed nonce carried through the redirect so the callback can confirm it started here. */
export function signOAuthState(): string {
  return jwt.sign({ purpose: "google-login" }, env.JWT_ACCESS_SECRET, { expiresIn: "10m" });
}

export function verifyOAuthState(state: string): boolean {
  try {
    const payload = jwt.verify(state, env.JWT_ACCESS_SECRET) as { purpose?: string };
    return payload.purpose === "google-login";
  } catch {
    return false;
  }
}

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  emailVerified: boolean;
}

/** Builds the "Sign in with Google" consent screen URL. `state` round-trips CSRF protection + post-login redirect intent. */
export function buildGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_LOGIN_REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    prompt: "select_account",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/** Exchanges the authorization code from the callback for the signed-in user's profile. */
export async function fetchGoogleProfile(code: string): Promise<GoogleProfile> {
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_LOGIN_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    throw new UnauthorizedError("Could not verify Google sign-in — the code may have expired. Please try again.");
  }
  const { access_token: accessToken } = (await tokenRes.json()) as { access_token: string };

  const profileRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!profileRes.ok) {
    throw new UnauthorizedError("Could not fetch your Google profile. Please try again.");
  }

  const profile = (await profileRes.json()) as {
    sub: string;
    email: string;
    name?: string;
    picture?: string;
    email_verified?: boolean;
  };

  return {
    googleId: profile.sub,
    email: profile.email,
    name: profile.name ?? profile.email.split("@")[0],
    avatarUrl: profile.picture ?? null,
    emailVerified: profile.email_verified ?? false,
  };
}
