import type { Request, Response } from "express";
import { registerSchema, loginSchema, refreshSchema, updateProfileSchema, forgotPasswordSchema, resetPasswordSchema } from "./auth.schema";
import * as authService from "./auth.service";
import { buildGoogleAuthUrl, fetchGoogleProfile, signOAuthState, verifyOAuthState } from "@/lib/google-oauth";
import { env } from "@/config/env";
import { AppError } from "@/lib/errors";
import { saveMediaBuffer } from "@/lib/media-storage";

export async function registerHandler(req: Request, res: Response) {
  const input = registerSchema.parse(req.body);
  const result = await authService.register(input);
  res.status(201).json(result);
}

export async function loginHandler(req: Request, res: Response) {
  const input = loginSchema.parse(req.body);
  const result = await authService.login(input);
  res.status(200).json(result);
}

export async function refreshHandler(req: Request, res: Response) {
  const { refreshToken } = refreshSchema.parse(req.body);
  const result = await authService.refresh(refreshToken);
  res.status(200).json(result);
}

export async function logoutHandler(req: Request, res: Response) {
  const { refreshToken } = refreshSchema.parse(req.body);
  await authService.logout(refreshToken);
  res.status(204).send();
}

export async function meHandler(req: Request, res: Response) {
  const result = await authService.me(req.auth!.userId, req.auth!.workspaceId);
  res.status(200).json(result);
}

export async function updateProfileHandler(req: Request, res: Response) {
  const input = updateProfileSchema.parse(req.body);
  const user = await authService.updateProfile(req.auth!.userId, input);
  res.status(200).json(user);
}

export async function uploadAvatarHandler(req: Request, res: Response) {
  const file = req.file;
  if (!file) throw new AppError("No image file was uploaded.", 400);

  const extension = file.mimetype === "image/png" ? "png" : "jpg";
  const avatarUrl = await saveMediaBuffer(file.buffer, extension);
  const user = await authService.updateProfile(req.auth!.userId, { avatarUrl });
  res.status(200).json(user);
}

export async function forgotPasswordHandler(req: Request, res: Response) {
  const input = forgotPasswordSchema.parse(req.body);
  await authService.requestPasswordReset(input);
  // Generic response regardless of outcome — never reveals whether the email exists.
  res.status(200).json({ message: "If an account exists for that email, a reset link has been sent." });
}

export async function resetPasswordHandler(req: Request, res: Response) {
  const input = resetPasswordSchema.parse(req.body);
  const result = await authService.resetPassword(input);
  res.status(200).json(result);
}

/** Kicks off "Continue with Google" — redirects the browser to Google's consent screen. */
export async function googleRedirectHandler(_req: Request, res: Response) {
  const state = signOAuthState();
  res.redirect(buildGoogleAuthUrl(state));
}

/**
 * Google redirects the browser back here with `code`/`state` after consent.
 * We exchange the code, sign the person in (or create their workspace), and
 * hand tokens to the frontend via a one-time redirect — the callback page
 * reads them from the URL and stores them the same way email/password login does.
 */
export async function googleCallbackHandler(req: Request, res: Response) {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
  const failureUrl = `${env.WEB_APP_URL}/login?error=google_failed`;

  if (error || !code || !state || !verifyOAuthState(state)) {
    return res.redirect(failureUrl);
  }

  try {
    const profile = await fetchGoogleProfile(code);
    const result = await authService.loginWithGoogle(profile);
    if (result.pending) {
      return res.redirect(`${env.WEB_APP_URL}/signup/pending`);
    }
    const params = new URLSearchParams({ access_token: result.accessToken, refresh_token: result.refreshToken });
    res.redirect(`${env.WEB_APP_URL}/auth/callback?${params.toString()}`);
  } catch {
    res.redirect(failureUrl);
  }
}
