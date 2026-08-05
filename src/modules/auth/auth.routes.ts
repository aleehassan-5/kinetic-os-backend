import { Router, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth } from "@/middleware/auth";
import { AppError } from "@/lib/errors";
import {
  registerHandler,
  loginHandler,
  refreshHandler,
  logoutHandler,
  meHandler,
  updateProfileHandler,
  changePasswordHandler,
  uploadAvatarHandler,
  googleRedirectHandler,
  googleCallbackHandler,
  forgotPasswordHandler,
  resetPasswordHandler,
} from "./auth.controller";

const router = Router();

// Small, image-only — this is a profile photo, not a document upload.
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!["image/jpeg", "image/png"].includes(file.mimetype)) {
      cb(new Error("Only JPG or PNG images are allowed"));
      return;
    }
    cb(null, true);
  },
});

function handleAvatarUpload(req: Request, res: Response, next: NextFunction) {
  avatarUpload.single("file")(req, res, (err: unknown) => {
    if (!err) return next();
    const message = err instanceof Error && err.message === "File too large" ? "Image must be under 2MB." : "Couldn't process that image — try a JPG or PNG under 2MB.";
    next(new AppError(message, 400));
  });
}

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
router.post("/me/avatar", requireAuth, handleAvatarUpload, asyncHandler(uploadAvatarHandler));
router.post("/change-password", requireAuth, resetLimiter, asyncHandler(changePasswordHandler));
router.post("/forgot-password", resetLimiter, asyncHandler(forgotPasswordHandler));
router.post("/reset-password", resetLimiter, asyncHandler(resetPasswordHandler));

// "Continue with Google" — browser-redirect flow, not JSON endpoints.
router.get("/google", asyncHandler(googleRedirectHandler));
router.get("/google/callback", asyncHandler(googleCallbackHandler));

export default router;
