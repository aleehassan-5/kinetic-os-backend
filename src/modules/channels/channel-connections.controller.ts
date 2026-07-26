import type { Request, Response } from "express";
import type { Channel } from "@prisma/client";
import { connectChannelSchema } from "./channel-connections.schema";
import * as channelConnectionsService from "./channel-connections.service";

export async function listConnectionsHandler(req: Request, res: Response) {
  const connections = await channelConnectionsService.listConnections(req.auth!.workspaceId);
  res.status(200).json({ connections });
}

export async function connectChannelHandler(req: Request, res: Response) {
  const input = connectChannelSchema.parse(req.body);
  const result = await channelConnectionsService.connectChannel(req.auth!.workspaceId, input);
  res.status(200).json(result);
}

export async function disconnectChannelHandler(req: Request, res: Response) {
  const result = await channelConnectionsService.disconnectChannel(
    req.auth!.workspaceId,
    req.params.channel as Channel
  );
  res.status(200).json(result);
}
