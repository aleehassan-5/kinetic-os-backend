import { z } from "zod";

export const createFaqSchema = z.object({
  title: z.string().min(2).max(200),
  content: z.string().min(1).max(20000),
});

export const createUrlDocumentSchema = z.object({
  title: z.string().min(2).max(200),
  url: z.string().url(),
});
