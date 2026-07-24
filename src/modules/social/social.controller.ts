import type { Request, Response } from "express";
import {
  listPostsQuerySchema,
  createPostSchema,
  updatePostSchema,
  connectAccountSchema,
} from "./social.schema";
import * as socialService from "./social.service";

export async function listPostsHandler(req: Request, res: Response) {
  const filters = listPostsQuerySchema.parse(req.query);
  const posts = await socialService.listPosts(req.auth!.workspaceId, filters);
  res.status(200).json({ posts });
}

export async function getPostHandler(req: Request, res: Response) {
  const post = await socialService.getPost(req.auth!.workspaceId, req.params.postId);
  res.status(200).json(post);
}

export async function createPostHandler(req: Request, res: Response) {
  const input = createPostSchema.parse(req.body);
  const post = await socialService.createPost(req.auth!.workspaceId, input);
  res.status(201).json(post);
}

export async function updatePostHandler(req: Request, res: Response) {
  const input = updatePostSchema.parse(req.body);
  const post = await socialService.updatePost(req.auth!.workspaceId, req.params.postId, input);
  res.status(200).json(post);
}

export async function deletePostHandler(req: Request, res: Response) {
  const result = await socialService.deletePost(req.auth!.workspaceId, req.params.postId);
  res.status(200).json(result);
}

export async function publishNowHandler(req: Request, res: Response) {
  const post = await socialService.publishPost(req.auth!.workspaceId, req.params.postId);
  res.status(200).json(post);
}

export async function listAccountsHandler(req: Request, res: Response) {
  const accounts = await socialService.listAccounts(req.auth!.workspaceId);
  res.status(200).json({ accounts });
}

export async function connectAccountHandler(req: Request, res: Response) {
  const input = connectAccountSchema.parse(req.body);
  const account = await socialService.connectAccount(req.auth!.workspaceId, input);
  res.status(200).json(account);
}

export async function listCommentsHandler(req: Request, res: Response) {
  const comments = await socialService.listComments(req.auth!.workspaceId);
  res.status(200).json({ comments });
}
