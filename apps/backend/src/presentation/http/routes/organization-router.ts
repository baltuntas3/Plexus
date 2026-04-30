import { Router } from "express";
import { OrganizationController } from "../controllers/organization-controller.js";
import { createRequireAuth } from "../middleware/require-auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import type { OrganizationComposition } from "../../../composition/organization-composition.js";
import type { ITokenService } from "../../../application/services/token-service.js";
import type { RequirePermission } from "../middleware/require-permission.js";

// Two routers: the org-scoped one (mounted at `/organizations/:orgId`)
// and a separate flat one for redemption (mounted at `/invitations`)
// because `AcceptInvitation` runs **before** the user is a member —
// `requirePermission` would reject them on the membership lookup. The
// invitation acceptance link points at the flat path so the public URL
// doesn't leak the target org id either.

export const createOrganizationRouter = (
  orgs: OrganizationComposition,
  tokens: ITokenService,
  requirePermission: RequirePermission,
): Router => {
  const router = Router({ mergeParams: true });
  const controller = new OrganizationController(orgs);
  const requireAuth = createRequireAuth(tokens);

  router.use(requireAuth);

  // Members.
  router.get(
    "/members",
    requirePermission("member:read"),
    asyncHandler(controller.listMembers),
  );
  router.patch(
    "/members/:memberId",
    requirePermission("member:role:update"),
    asyncHandler(controller.updateMemberRole),
  );
  router.delete(
    "/members/:memberId",
    requirePermission("member:remove"),
    asyncHandler(controller.removeMember),
  );

  // Invitations (org-scoped admin path).
  router.get(
    "/invitations",
    requirePermission("invitation:read"),
    asyncHandler(controller.listInvitations),
  );
  router.post(
    "/invitations",
    requirePermission("member:invite"),
    asyncHandler(controller.inviteMember),
  );
  router.delete(
    "/invitations/:invitationId",
    requirePermission("member:invite"),
    asyncHandler(controller.cancelInvitation),
  );

  // Ownership transfer.
  router.post(
    "/ownership/transfer",
    requirePermission("ownership:transfer"),
    asyncHandler(controller.transferOwnership),
  );

  // Audit log.
  router.get(
    "/events",
    requirePermission("audit:read"),
    asyncHandler(controller.listEvents),
  );

  // Approval policy. Single endpoint with PUT semantics (replace or
  // clear) — separate "enable" / "disable" routes would be two ways to
  // express the same state and rot out of sync.
  router.put(
    "/approval-policy",
    requirePermission("policy:edit"),
    asyncHandler(controller.setApprovalPolicy),
  );

  // Approval requests: issue, list, vote, cancel. Issue is mounted
  // under the prompt path so the URL itself encodes "approval to
  // promote prompt X version Y to production" — cleaner than a flat
  // `/approval-requests` POST that takes promptId/version in the body.
  router.post(
    "/prompts/:promptId/versions/:version/approval-requests",
    requirePermission("prompt:promote"),
    asyncHandler(controller.requestVersionApproval),
  );
  router.get(
    "/approval-requests",
    requirePermission("version:approve"),
    asyncHandler(controller.listPendingApprovalRequests),
  );
  router.post(
    "/approval-requests/:requestId/approve",
    requirePermission("version:approve"),
    asyncHandler(controller.approveVersionRequest),
  );
  router.post(
    "/approval-requests/:requestId/reject",
    requirePermission("version:approve"),
    asyncHandler(controller.rejectVersionRequest),
  );
  // Cancel is gated at the lowest tier that can ever legitimately
  // cancel: the requester (editor+, who could issue) can cancel their
  // own; admins can cancel anyone's via the `approval:cancel:any`
  // permission. The use case enforces the requester-self check.
  router.post(
    "/approval-requests/:requestId/cancel",
    requirePermission("prompt:promote"),
    asyncHandler(controller.cancelVersionRequest),
  );

  return router;
};

// Flat router for redemption — no `:orgId` param, no permission check.
// The token + email-on-token pair is the entire access guard.
export const createInvitationRedemptionRouter = (
  orgs: OrganizationComposition,
  tokens: ITokenService,
): Router => {
  const router = Router();
  const controller = new OrganizationController(orgs);
  router.use(createRequireAuth(tokens));
  router.post("/accept", asyncHandler(controller.acceptInvitation));
  return router;
};
