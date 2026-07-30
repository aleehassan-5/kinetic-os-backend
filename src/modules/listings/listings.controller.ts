import type { Request, Response } from "express";
import * as listingsService from "./listings.service";
import { createListingSchema, updateListingSchema, contentPlanRequestSchema } from "./listings.schema";

export async function listListingsHandler(req: Request, res: Response) {
  const listings = await listingsService.listListings(req.auth!.workspaceId, req.query.status as string | undefined);
  res.status(200).json({ listings });
}

export async function getListingHandler(req: Request, res: Response) {
  const listing = await listingsService.getListing(req.auth!.workspaceId, req.params.listingId);
  res.status(200).json(listing);
}

export async function createListingHandler(req: Request, res: Response) {
  const input = createListingSchema.parse(req.body);
  const listing = await listingsService.createListing(req.auth!.workspaceId, input);
  res.status(201).json(listing);
}

export async function updateListingHandler(req: Request, res: Response) {
  const input = updateListingSchema.parse(req.body);
  const listing = await listingsService.updateListing(req.auth!.workspaceId, req.params.listingId, input);
  res.status(200).json(listing);
}

export async function deleteListingHandler(req: Request, res: Response) {
  await listingsService.deleteListing(req.auth!.workspaceId, req.params.listingId);
  res.status(204).send();
}

export async function contentPlanHandler(req: Request, res: Response) {
  const { platforms, postCount } = contentPlanRequestSchema.parse(req.body ?? {});
  const result = await listingsService.proposeAndGenerateContentPlan(
    req.auth!.workspaceId,
    req.params.listingId,
    platforms,
    postCount
  );
  res.status(201).json(result);
}
