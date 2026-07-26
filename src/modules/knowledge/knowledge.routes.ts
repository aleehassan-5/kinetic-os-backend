import { Router } from "express";
import type { Request } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth } from "@/middleware/auth";
import {
  uploadFileHandler,
  createFaqHandler,
  crawlUrlHandler,
  listDocumentsHandler,
  deleteDocumentHandler,
} from "./knowledge.controller";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Ingestion (upload/crawl) triggers chunking + embedding generation — real
// billed AI calls — so it gets its own tighter limit, separate from the
// cheap read-only list endpoint.
const ingestLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.auth?.workspaceId ?? req.ip ?? "unknown",
});

const router = Router();
router.use(requireAuth);

router.get("/", asyncHandler(listDocumentsHandler));
router.post("/upload", ingestLimiter, upload.single("file"), asyncHandler(uploadFileHandler));
router.post("/faq", ingestLimiter, asyncHandler(createFaqHandler));
router.post("/crawl", ingestLimiter, asyncHandler(crawlUrlHandler));
router.delete("/:documentId", asyncHandler(deleteDocumentHandler));

export default router;
