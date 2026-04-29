import type { ISODateString } from "./common.js";

// Multi-tenant scope. The Organization is the *registration unit* of the
// platform: every user signs up with an org, every aggregate (Prompt,
// PromptVersion, Benchmark, Dataset, ExecutionLog) lives inside one org's
// scope, and authorization is rooted in a member's role within an org.
//
// Roles are a closed set. New roles are added by amending this enum and
// the rol→permission map in `permissions.ts` together; runtime "custom
// roles" are explicitly out of scope (YAGNI; would require dynamic
// permission storage and a UI for it).
export const ORGANIZATION_ROLES = [
  "owner",
  "admin",
  "editor",
  "approver",
  "viewer",
] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export interface OrganizationDto {
  id: string;
  name: string;
  // URL-friendly identifier. Globally unique across the platform so
  // `/orgs/<slug>` paths stay stable even after a rename.
  slug: string;
  // The current sole `owner` member's userId. Mirrors the role row but kept
  // on the org for the common "who founded / currently owns this" lookup
  // without joining the membership collection.
  ownerId: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface OrganizationMemberDto {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  // The userId who issued the invitation that created this membership.
  // Null for the founding owner (no inviter exists). Kept for audit and
  // UI breadcrumbs.
  invitedBy: string | null;
  joinedAt: ISODateString;
}

export const INVITATION_STATUSES = [
  "pending",
  "accepted",
  "cancelled",
  "expired",
] as const;
export type OrganizationInvitationStatus = (typeof INVITATION_STATUSES)[number];

// Public-facing invitation projection. The redemption token itself is
// **never** included — only the recipient (via email) gets the plaintext
// link out-of-band; the API only exposes the invitation metadata so admins
// can see "who is pending" without being handed a way to impersonate them.
export interface OrganizationInvitationDto {
  id: string;
  organizationId: string;
  email: string;
  role: OrganizationRole;
  invitedBy: string;
  status: OrganizationInvitationStatus;
  expiresAt: ISODateString;
  createdAt: ISODateString;
  resolvedAt: ISODateString | null;
}

export const MEMBERSHIP_EVENT_TYPES = [
  "invited",
  "cancelled",
  "joined",
  "role_changed",
  "removed",
  "ownership_transferred",
] as const;
export type OrganizationMembershipEventType =
  (typeof MEMBERSHIP_EVENT_TYPES)[number];

// Append-only audit log row. One per membership-changing operation. UI
// renders these on the Members tab as a "Geçmiş" timeline; future
// integrations (export, SIEM forwarding) read off the same shape.
export interface OrganizationMembershipEventDto {
  id: string;
  organizationId: string;
  eventType: OrganizationMembershipEventType;
  actorUserId: string;
  // Either the affected member's userId (joined/role_changed/removed/
  // ownership_transferred) or null when the event targets an email that
  // has not yet accepted (invited/cancelled). `targetEmail` carries the
  // recipient address in those cases.
  targetUserId: string | null;
  targetEmail: string | null;
  oldRole: OrganizationRole | null;
  newRole: OrganizationRole | null;
  occurredAt: ISODateString;
}
