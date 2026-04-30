import { z } from "zod";
import { ASSIGNABLE_ROLES } from "@plexus/shared-types";

// Owner-exclusion lives in the shared-types `ASSIGNABLE_ROLES` const so
// the rule is one source of truth across backend Zod, frontend pickers,
// and admin UI lists. This schema is a thin runtime gate over that tuple.
const assignableRoleSchema = z.enum(
  ASSIGNABLE_ROLES as unknown as ["admin", "editor", "approver", "viewer"],
);

export const inviteMemberInputSchema = z.object({
  email: z.string().email().max(254),
  role: assignableRoleSchema,
});
export type InviteMemberInputDto = z.infer<typeof inviteMemberInputSchema>;

export const updateMemberRoleInputSchema = z.object({
  role: assignableRoleSchema,
});
export type UpdateMemberRoleInputDto = z.infer<typeof updateMemberRoleInputSchema>;

export const acceptInvitationInputSchema = z.object({
  // Plaintext token from the invitation link. The use case hashes it
  // and looks up by hash; the plaintext never reaches storage.
  token: z.string().min(1).max(256),
});
export type AcceptInvitationInputDto = z.infer<typeof acceptInvitationInputSchema>;

export const transferOwnershipInputSchema = z.object({
  // The userId of an existing member that will become the new owner.
  // Must be a current org member; the use case verifies membership
  // before the transfer.
  newOwnerUserId: z.string().min(1),
});
export type TransferOwnershipInputDto = z.infer<typeof transferOwnershipInputSchema>;

// `requiredApprovals: null` clears the policy and re-enables direct
// `→ production` promotion. Range bounds (1..10, integer) are enforced
// inside the `Organization` aggregate so the schema is intentionally
// permissive on number range — the entity is the single source of truth.
export const setApprovalPolicyInputSchema = z.object({
  requiredApprovals: z.number().int().nullable(),
});
export type SetApprovalPolicyInputDto = z.infer<typeof setApprovalPolicyInputSchema>;
