import type { Request, Response } from "express";
import { AppError } from "@/lib/errors";
import { createFaqSchema, createUrlDocumentSchema } from "./knowledge.schema";
import * as knowledgeService from "./knowledge.service";
import { extractTextFromFile, extractTextFromUrl } from "./file-extraction";

function sourceTypeFromMimetype(mimetype: string, filename: string): "PDF" | "DOCX" | "FAQ" | "SHEET" {
  if (mimetype === "application/pdf" || filename.endsWith(".pdf")) return "PDF";
  if (filename.endsWith(".docx")) return "DOCX";
  if (filename.endsWith(".csv") || filename.endsWith(".xlsx")) return "SHEET";
  return "FAQ";
}

export async function uploadFileHandler(req: Request, res: Response) {
  const file = req.file;
  if (!file) throw new AppError("No file uploaded", 422);

  const text = await extractTextFromFile(file.buffer, file.mimetype, file.originalname);
  const document = await knowledgeService.createDocument(req.auth!.workspaceId, {
    title: file.originalname,
    sourceType: sourceTypeFromMimetype(file.mimetype, file.originalname),
    rawText: text,
  });

  res.status(201).json(document);
}

export async function createFaqHandler(req: Request, res: Response) {
  const input = createFaqSchema.parse(req.body);
  const document = await knowledgeService.createDocument(req.auth!.workspaceId, {
    title: input.title,
    sourceType: "FAQ",
    rawText: input.content,
  });
  res.status(201).json(document);
}

export async function crawlUrlHandler(req: Request, res: Response) {
  const input = createUrlDocumentSchema.parse(req.body);
  const text = await extractTextFromUrl(input.url);
  const document = await knowledgeService.createDocument(req.auth!.workspaceId, {
    title: input.title,
    sourceType: "URL",
    sourceUrl: input.url,
    rawText: text,
  });
  res.status(201).json(document);
}

export async function listDocumentsHandler(req: Request, res: Response) {
  const documents = await knowledgeService.listDocuments(req.auth!.workspaceId);
  res.status(200).json({ documents });
}

export async function deleteDocumentHandler(req: Request, res: Response) {
  await knowledgeService.deleteDocument(req.auth!.workspaceId, req.params.documentId);
  res.status(204).send();
}
