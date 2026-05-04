import type { Organization } from "../entities/organization.js";
import type { OrganizationMember } from "../entities/organization-member.js";
import type { OrganizationRole } from "@plexus/shared-types";
import {
  OrganizationOwnerInvariantError,
} from "../errors/domain-error.js";

// Domain service that owns the cross-aggregate "exactly one owner"
// invariant. The invariant spans three aggregates — the Organization root's
// `ownerId` pointer plus the two affected `OrganizationMember` rows — so it
// cannot live inside any single aggregate's encapsulation. A domain service
// is the canonical DDD home for that kind of multi-aggregate rule.
//
// Use cases call this function and never touch the underlying aggregate
// methods directly: the function is the single place that decides when it
// is legitimate to flip an `owner` role, and it pairs the demote/promote
// with the root pointer flip so all three writes always agree. The
// orchestrating use case only handles authentication, loading, persistence,
// and audit-event emission — none of the invariant logic.
//
// The aggregate-level escape hatch (`applyOwnershipTransfer`) is still
// public because TypeScript has no package-private modifier; the convention
// is enforced by code review and the comment on that method, plus a project-
// wide grep guard would catch direct callers outside this file.

interface TransferOwnershipInput {
  organization: Organization;
  outgoingMember: OrganizationMember;
  incomingMember: OrganizationMember;
  actorUserId: string;
  newOwnerUserId: string;
}

interface TransferOwnershipOutcome {
  // Role the incoming member held just before the promotion. Use cases
  // record this in the audit event so the timeline reflects the actual
  // prior role (could be admin/editor/approver/viewer) rather than a
  // fabricated default.
  incomingPriorRole: OrganizationRole;
}

export const transferOrganizationOwnership = (
  input: TransferOwnershipInput,
): TransferOwnershipOutcome => {
  const { organization, outgoingMember, incomingMember, actorUserId, newOwnerUserId } = input;

  if (actorUserId === newOwnerUserId) {
    throw OrganizationOwnerInvariantError(
      "Cannot transfer ownership to yourself",
    );
  }
  // The actor must currently be the org's owner per the root pointer.
  // Authorization middleware already gates the route, but a stale token
  // whose user is no longer owner would otherwise pass — the org root is
  // the source of truth.
  if (organization.ownerId !== actorUserId) {
    throw OrganizationOwnerInvariantError(
      "Only the current owner can transfer ownership",
    );
  }
  // Aggregate-level cross checks: the loaded member rows must correspond
  // to the actor and target users, and the outgoing member must actually
  // hold `owner`. Use cases load the rows by `(orgId, userId)` so a
  // mismatch here is a programming error, not a user-facing one.
  if (outgoingMember.userId !== actorUserId || outgoingMember.role !== "owner") {
    throw OrganizationOwnerInvariantError(
      "Outgoing member is not the current owner",
    );
  }
  if (incomingMember.userId !== newOwnerUserId) {
    throw OrganizationOwnerInvariantError(
      "Incoming member does not match the requested new owner",
    );
  }
  if (incomingMember.organizationId !== organization.id) {
    throw OrganizationOwnerInvariantError(
      "Incoming member belongs to a different organization",
    );
  }

  const incomingPriorRole = incomingMember.role;
  // Three paired mutations. The aggregate methods used here are
  // restricted-by-convention to this service: see the comment on
  // `OrganizationMember.applyOwnershipTransfer` and `Organization.setOwnerId`.
  outgoingMember.applyOwnershipTransfer("demote");
  incomingMember.applyOwnershipTransfer("promote");
  organization.setOwnerId(newOwnerUserId);

  return { incomingPriorRole };
};
