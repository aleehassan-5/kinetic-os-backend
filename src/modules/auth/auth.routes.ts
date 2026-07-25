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
} from "./auth.controller";

const router = Router();

// Tighter limit on credential endpoints to blunt brute-force / credential stuffing.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

router.post("/register", authLimiter, asyncHandler(registerHandler));
router.post("/login", authLimiter, asyncHandler(loginHandler));
router.post("/refresh", authLimiter, asyncHandler(refreshHandler));
router.post("/logout", asyncHandler(logoutHandler));
router.get("/me", requireAuth, asyncHandler(meHandler));
router.patch("/me", requireAuth, asyncHandler(updateProfileHandler));

// "Continue with Google" — browser-redirect flow, not JSON endpoints.
router.get("/google", asyncHandler(googleRedirectHandler));
router.get("/google/callback", asyncHandler(googleCallbackHandler));

export default router;
