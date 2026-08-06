import type { Request, Response } from "express";
import { z } from "zod";
import * as searchService from "./search.service";

const searchQuerySchema = z.object({
  q: z.string().optional().default(""),
});

export async function globalSearchHandler(req: Request, res: Response) {
  const { q } = searchQuerySchema.parse(req.query);
  const results = await searchService.globalSearch(req.auth!.workspaceId, q);
  res.status(200).json(results);
}
