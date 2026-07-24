import { Router } from "express";
import multer from "multer";
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

const router = Router();
router.use(requireAuth);

router.get("/", asyncHandler(listDocumentsHandler));
router.post("/upload", upload.single("file"), asyncHandler(uploadFileHandler));
router.post("/faq", asyncHandler(createFaqHandler));
router.post("/crawl", asyncHandler(crawlUrlHandler));
router.delete("/:documentId", asyncHandler(deleteDocumentHandler));

export default router;
