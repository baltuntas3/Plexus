import type {
  OrganizationDto,
  OrganizationInvitationDto,
  OrganizationMemberDto,
  OrganizationMembershipEventDto,
} from "@plexus/shared-types";
import type { Organization } from "../../domain/entities/organization.js";
import type { OrganizationInvitation } from "../../domain/entities/organization-invitation.js";
import type { OrganizationMember } from "../../domain/entities/organization-member.js";
import type { OrganizationMembershipEvent } from "../../domain/entities/organization-membership-event.js";

// Single source of truth for org-context entity → DTO mappings. Use cases
// and (sparingly) controllers import these so the DTO shape stays
// defined in exactly one place — particularly important for invitations,
// where the `tokenHash` strip is a security-sensitive omission that must
// not drift between issuance, listing, and any future projection path.

export const toOrganizationDto = (org: Organization): OrganizationDto => ({
  id: org.id,
  name: org.name,
  slug: org.slug,
  ownerId: org.ownerId,
  approvalPolicy: org.approvalPolicy,
  createdAt: org.createdAt.toISOString(),
  updatedAt: org.updatedAt.toISOString(),
});

export const toMemberDto = (member: OrganizationMember): OrganizationMemberDto => ({
  id: member.id,
  organizationId: member.organizationId,
  userId: member.userId,
  role: member.role,
  invitedBy: member.invitedBy,
  joinedAt: member.joinedAt.toISOString(),
});

// `tokenHash` is **deliberately** omitted. Even admins of the issuing
// org should never see the hash — possessing it is enough to swap into
// `findByTokenHash` and impersonate a redemption. The plaintext token
// is returned exactly once, in the `InviteMember` issue response, and
// never persisted in clear form anywhere else.
export const toInvitationDto = (
  invitation: OrganizationInvitation,
): OrganizationInvitationDto => ({
  id: invitation.id,
  organizationId: invitation.organizationId,
  email: invitation.email,
  role: invitation.role,
  invitedBy: invitation.invitedBy,
  status: invitation.status,
  expiresAt: invitation.expiresAt.toISOString(),
  createdAt: invitation.createdAt.toISOString(),
  resolvedAt: invitation.resolvedAt
    ? invitation.resolvedAt.toISOString()
    : null,
});

export const toMembershipEventDto = (
  event: OrganizationMembershipEvent,
): OrganizationMembershipEventDto => ({
  id: event.id,
  organizationId: event.organizationId,
  eventType: event.eventType,
  actorUserId: event.actorUserId,
  targetUserId: event.targetUserId,
  targetEmail: event.targetEmail,
  oldRole: event.oldRole,
  newRole: event.newRole,
  occurredAt: event.occurredAt.toISOString(),
});
