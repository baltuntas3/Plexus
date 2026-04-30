import type { Request, RequestHandler, Response } from "express";
import type { OrganizationMembershipEventDto } from "@plexus/shared-types";
import {
  acceptInvitationInputSchema,
  inviteMemberInputSchema,
  setApprovalPolicyInputSchema,
  transferOwnershipInputSchema,
  updateMemberRoleInputSchema,
} from "../../../application/dto/organization-dto.js";
import { roleHasPermission } from "../../../application/services/permissions.js";
import { ForbiddenError, UnauthorizedError } from "../../../domain/errors/domain-error.js";
import type { OrganizationComposition } from "../../../composition/organization-composition.js";
import {
  getAuthContext as requireAuth,
  getAuthOnlyContext as requireAuthOnly,
  getRequiredParam as requireParam,
} from "../utils/request-context.js";

// Org-scope guard. Routes are mounted under `/organizations/:orgId/...`
// but the active org is also encoded in the JWT. Mismatch = caller
// trying to act on an org their session is not scoped to. Authorization
// middleware would have already rejected cross-tenant action via
// `requirePermission` (membership lookup uses `req.organizationId`),
// but the URL/JWT mismatch is a separate misuse signal worth surfacing
// distinctly so frontend bugs (stale URL after switch) fail loud.
const assertOrgMatch = (req: Request, urlOrgId: string): void => {
  if (req.organizationId !== urlOrgId) {
    throw ForbiddenError(
      "URL organization does not match the active session organization",
    );
  }
};

export class OrganizationController {
  constructor(private readonly orgs: OrganizationComposition) {}

  // ── Members ────────────────────────────────────────────────────────────

  listMembers: RequestHandler = async (req: Request, res: Response) => {
    const { organizationId } = requireAuth(req);
    const orgId = requireParam(req, "orgId");
    assertOrgMatch(req, orgId);
    const members = await this.orgs.listMembers.execute({ organizationId });
    res.json({ members });
  };

  updateMemberRole: RequestHandler = async (req: Request, res: Response) => {
    const { userId, organizationId } = requireAuth(req);
    const orgId = requireParam(req, "orgId");
    assertOrgMatch(req, orgId);
    const memberId = requireParam(req, "memberId");
    const input = updateMemberRoleInputSchema.parse(req.body);
    await this.orgs.updateMemberRole.execute({
      organizationId,
      actorUserId: userId,
      targetMemberId: memberId,
      role: input.role,
    });
    res.status(204).end();
  };

  removeMember: RequestHandler = async (req: Request, res: Response) => {
    const { userId, organizationId } = requireAuth(req);
    const orgId = requireParam(req, "orgId");
    assertOrgMatch(req, orgId);
    const memberId = requireParam(req, "memberId");
    await this.orgs.removeMember.execute({
      organizationId,
      actorUserId: userId,
      targetMemberId: memberId,
    });
    res.status(204).end();
  };

  // ── Invitations ────────────────────────────────────────────────────────

  listInvitations: RequestHandler = async (req: Request, res: Response) => {
    const { organizationId } = requireAuth(req);
    const orgId = requireParam(req, "orgId");
    assertOrgMatch(req, orgId);
    const invitations = await this.orgs.listInvitations.execute({
      organizationId,
    });
    res.json({ invitations });
  };

  inviteMember: RequestHandler = async (req: Request, res: Response) => {
    const { userId, organizationId } = requireAuth(req);
    const orgId = requireParam(req, "orgId");
    assertOrgMatch(req, orgId);
    const input = inviteMemberInputSchema.parse(req.body);
    const result = await this.orgs.inviteMember.execute({
      organizationId,
      actorUserId: userId,
      email: input.email,
      role: input.role,
    });
    // Plaintext token returned **once** in the issue response so the
    // caller can forward it to the recipient (email link). Never
    // persisted in this shape, never returned by `listInvitations`.
    res.status(201).json({
      invitation: result.invitation,
      token: result.plaintextToken,
    });
  };

  cancelInvitation: RequestHandler = async (req: Request, res: Response) => {
    const { userId, organizationId } = requireAuth(req);
    const orgId = requireParam(req, "orgId");
    assertOrgMatch(req, orgId);
    const invitationId = requireParam(req, "invitationId");
    await this.orgs.cancelInvitation.execute({
      organizationId,
      actorUserId: userId,
      invitationId,
    });
    res.status(204).end();
  };

  // Public-shape redemption — caller may not yet be a member of the
  // target org. Auth-only, no `requirePermission` (see route file).
  acceptInvitation: RequestHandler = async (req: Request, res: Response) => {
    const { userId, email } = requireAuthOnly(req);
    const input = acceptInvitationInputSchema.parse(req.body);
    const result = await this.orgs.acceptInvitation.execute({
      token: input.token,
      actorUserId: userId,
      actorEmail: email,
    });
    res.status(201).json({ organizationId: result.organizationId });
  };

  // ── Ownership ──────────────────────────────────────────────────────────

  transferOwnership: RequestHandler = async (req: Request, res: Response) => {
    const { userId, organizationId } = requireAuth(req);
    const orgId = requireParam(req, "orgId");
    assertOrgMatch(req, orgId);
    const input = transferOwnershipInputSchema.parse(req.body);
    await this.orgs.transferOwnership.execute({
      organizationId,
      actorUserId: userId,
      newOwnerUserId: input.newOwnerUserId,
    });
    res.status(204).end();
  };

  // ── Audit log ──────────────────────────────────────────────────────────

  listEvents: RequestHandler = async (req: Request, res: Response) => {
    const { organizationId } = requireAuth(req);
    const orgId = requireParam(req, "orgId");
    assertOrgMatch(req, orgId);
    const events: OrganizationMembershipEventDto[] =
      await this.orgs.listMembershipEvents.execute({ organizationId });
    res.json({ events });
  };

  // ── Approval policy ───────────────────────────────────────────────────

  // PUT semantics: full replacement of the policy. `requiredApprovals:
  // null` clears the gate; an integer installs/updates it. The full
  // updated org DTO comes back so the frontend doesn't need a separate
  // GET to refresh canonical state.
  setApprovalPolicy: RequestHandler = async (req: Request, res: Response) => {
    const { organizationId } = requireAuth(req);
    const orgId = requireParam(req, "orgId");
    assertOrgMatch(req, orgId);
    const input = setApprovalPolicyInputSchema.parse(req.body);
    const organization = await this.orgs.setApprovalPolicy.execute({
      organizationId,
      requiredApprovals: input.requiredApprovals,
    });
    res.json({ organization });
  };

  // ── Approval requests (production-promotion workflow) ─────────────────

  // Issue a request against `(promptId, version)`. The use case rejects
  // with VERSION_APPROVAL_NOT_ENABLED if the org has no policy.
  requestVersionApproval: RequestHandler = async (
    req: Request,
    res: Response,
  ) => {
    const { userId, organizationId } = requireAuth(req);
    const orgId = requireParam(req, "orgId");
    assertOrgMatch(req, orgId);
    const promptId = requireParam(req, "promptId");
    const version = requireParam(req, "version");
    const request = await this.orgs.requestVersionApproval.execute({
      organizationId,
      actorUserId: userId,
      promptId,
      version,
    });
    res.status(201).json({ request });
  };

  approveVersionRequest: RequestHandler = async (
    req: Request,
    res: Response,
  ) => {
    const { userId, organizationId } = requireAuth(req);
    const orgId = requireParam(req, "orgId");
    assertOrgMatch(req, orgId);
    const requestId = requireParam(req, "requestId");
    const request = await this.orgs.approveVersionRequest.execute({
      organizationId,
      actorUserId: userId,
      requestId,
    });
    res.json({ request });
  };

  rejectVersionRequest: RequestHandler = async (
    req: Request,
    res: Response,
  ) => {
    const { userId, organizationId } = requireAuth(req);
    const orgId = requireParam(req, "orgId");
    assertOrgMatch(req, orgId);
    const requestId = requireParam(req, "requestId");
    const request = await this.orgs.rejectVersionRequest.execute({
      organizationId,
      actorUserId: userId,
      requestId,
    });
    res.json({ request });
  };

  // Cancellation accepts both the requester (own request) and admins
  // (any request). The use case takes a pre-resolved `canCancelAny`
  // flag rather than depending on the permission map directly — kept
  // the application layer free of presentation concerns. Resolving
  // here uses the same role→permission map as `requirePermission`, so
  // the rule lives in exactly one place.
  cancelVersionRequest: RequestHandler = async (
    req: Request,
    res: Response,
  ) => {
    const { userId, organizationId } = requireAuth(req);
    const orgId = requireParam(req, "orgId");
    assertOrgMatch(req, orgId);
    const requestId = requireParam(req, "requestId");
    const role = req.organizationRole;
    if (!role) {
      throw UnauthorizedError();
    }
    const request = await this.orgs.cancelVersionRequest.execute({
      organizationId,
      actorUserId: userId,
      requestId,
      canCancelAny: roleHasPermission(role, "approval:cancel:any"),
    });
    res.json({ request });
  };

  listPendingApprovalRequests: RequestHandler = async (
    req: Request,
    res: Response,
  ) => {
    const { organizationId } = requireAuth(req);
    const orgId = requireParam(req, "orgId");
    assertOrgMatch(req, orgId);
    const requests = await this.orgs.listPendingApprovalRequests.execute({
      organizationId,
    });
    res.json({ requests });
  };
}
