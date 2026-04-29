import { z } from "zod";
import { ORGANIZATION_ROLES } from "@plexus/shared-types";

// Roles assignable through invitations and role updates. `owner` is
// excluded from both — ownership is transferred via the dedicated
// `TransferOwnership` flow, never assigned in place.
const ASSIGNABLE_ROLES = ORGANIZATION_ROLES.filter(
  (r): r is "admin" | "editor" | "approver" | "viewer" => r !== "owner",
);
const assignableRoleSchema = z.enum(
  ASSIGNABLE_ROLES as [
    "admin",
    "editor",
    "approver",
    "viewer",
  ],
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
