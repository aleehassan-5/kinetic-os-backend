import type { Request, Response } from "express";
import type { AiProvider } from "./ai-providers.schema";
import { connectAiProviderSchema } from "./ai-providers.schema";
import * as aiProvidersService from "./ai-providers.service";

export async function listAiProvidersHandler(req: Request, res: Response) {
  const providers = await aiProvidersService.listAiProviders(req.auth!.workspaceId);
  res.status(200).json({ providers });
}

export async function connectAiProviderHandler(req: Request, res: Response) {
  const input = connectAiProviderSchema.parse(req.body);
  const result = await aiProvidersService.connectAiProvider(req.auth!.workspaceId, input);
  res.status(200).json(result);
}

export async function testAiProviderHandler(req: Request, res: Response) {
  const input = connectAiProviderSchema.parse(req.body);
  const result = await aiProvidersService.testProviderKey(input.provider, input.apiKey);
  res.status(200).json(result);
}

export async function disconnectAiProviderHandler(req: Request, res: Response) {
  const result = await aiProvidersService.disconnectAiProvider(
    req.auth!.workspaceId,
    req.params.provider as AiProvider
  );
  res.status(200).json(result);
}
