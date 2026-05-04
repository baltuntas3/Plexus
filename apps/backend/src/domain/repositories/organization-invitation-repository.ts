import type { OrganizationInvitation } from "../entities/organization-invitation.js";

// Write-side port for invitations. The "one pending invitation per
// (orgId, email)" rule is enforced by the unique partial index in the
// repository implementations; `findByTokenHash` is the redemption path
// (recipient hands back the plaintext, the use case hashes it and
// matches here).
export interface IOrganizationInvitationRepository {
  findById(id: string): Promise<OrganizationInvitation | null>;
  // Used during redemption. The token plaintext is hashed by the use
  // case; this lookup is the only path that resolves a hash to an
  // invitation, and it intentionally does not narrow by org/email so
  // the redemption use case can surface specific error codes
  // (NOT_FOUND vs EMAIL_MISMATCH vs EXPIRED) per branch.
  findByTokenHash(tokenHash: string): Promise<OrganizationInvitation | null>;
  // Lists every invitation in an org regardless of status. UI's
  // "Invitations" tab paginates over this for admins.
  listByOrganization(
    organizationId: string,
  ): Promise<OrganizationInvitation[]>;
  save(invitation: OrganizationInvitation): Promise<void>;
}
