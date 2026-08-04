import { Router } from "express";
import { asyncHandler } from "@/middleware/error-handler";
import { requireAuth, requireSuperAdmin } from "@/middleware/auth";
import {
  listAccountsHandler,
  getAccountDetailHandler,
  approveAccountHandler,
  rejectAccountHandler,
  suspendAccountHandler,
  reactivateAccountHandler,
} from "./admin.controller";

const router = Router();

// Every route here is super_admin-only — no client, however senior,
// gets past requireSuperAdmin regardless of their workspace role.
router.use(requireAuth, requireSuperAdmin);

router.get("/accounts", asyncHandler(listAccountsHandler));
router.get("/accounts/:id", asyncHandler(getAccountDetailHandler));
router.post("/accounts/:id/approve", asyncHandler(approveAccountHandler));
router.post("/accounts/:id/reject", asyncHandler(rejectAccountHandler));
router.post("/accounts/:id/suspend", asyncHandler(suspendAccountHandler));
router.post("/accounts/:id/reactivate", asyncHandler(reactivateAccountHandler));

export default router;
