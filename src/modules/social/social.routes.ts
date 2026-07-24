import { Router } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth } from "@/middleware/auth";
import {
  listPostsHandler,
  getPostHandler,
  createPostHandler,
  updatePostHandler,
  deletePostHandler,
  publishNowHandler,
  listAccountsHandler,
  connectAccountHandler,
  listCommentsHandler,
} from "./social.controller";

const router = Router();
router.use(requireAuth);

router.get("/posts", asyncHandler(listPostsHandler));
router.post("/posts", asyncHandler(createPostHandler));
router.get("/posts/:postId", asyncHandler(getPostHandler));
router.patch("/posts/:postId", asyncHandler(updatePostHandler));
router.delete("/posts/:postId", asyncHandler(deletePostHandler));
router.post("/posts/:postId/publish-now", asyncHandler(publishNowHandler));

router.get("/accounts", asyncHandler(listAccountsHandler));
router.post("/accounts", asyncHandler(connectAccountHandler));

router.get("/comments", asyncHandler(listCommentsHandler));

export default router;
