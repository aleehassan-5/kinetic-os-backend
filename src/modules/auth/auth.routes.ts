import { Router } from "express";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth } from "@/middleware/auth";
import {
  registerHandler,
  loginHandler,
  refreshHandler,
  logoutHandler,
  meHandler,
  updateProfileHandler,
  googleRedirectHandler,
  googleCallbackHandler,
  forgotPasswordHandler,
  resetPasswordHandler,
} from "./auth.controller";

const router = Router();

// Tighter limit on credential endpoints to blunt brute-force / credential stuffing.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

// Stricter still — password reset requests trigger an email send per hit.
const resetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });

router.post("/register", authLimiter, asyncHandler(registerHandler));
router.post("/login", authLimiter, asyncHandler(loginHandler));
router.post("/refresh", authLimiter, asyncHandler(refreshHandler));
router.post("/logout", asyncHandler(logoutHandler));
router.get("/me", requireAuth, asyncHandler(meHandler));
router.patch("/me", requireAuth, asyncHandler(updateProfileHandler));
router.post("/forgot-password", resetLimiter, asyncHandler(forgotPasswordHandler));
router.post("/reset-password", resetLimiter, asyncHandler(resetPasswordHandler));

// "Continue with Google" — browser-redirect flow, not JSON endpoints.
router.get("/google", asyncHandler(googleRedirectHandler));
router.get("/google/callback", asyncHandler(googleCallbackHandler));

export default router;
