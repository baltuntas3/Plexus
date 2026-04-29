import type { OrganizationInvitation } from "../entities/organization-invitation.js";

// Write-side port for invitations. Two narrow lookups beyond the standard
// `findById`: `findActiveByOrganizationAndEmail` enforces the "one
// pending invitation per recipient" rule at the use-case layer, and
// `findByTokenHash` is the redemption path (recipient hands back the
// plaintext, the use case hashes it and matches here).
export interface IOrganizationInvitationRepository {
  findById(id: string): Promise<OrganizationInvitation | null>;
  // Returns the pending row for `(orgId, email)`, or null when no
  // pending invitation exists. Cancelled/accepted/expired rows are
  // ignored — the unique constraint targets only `pending`.
  findActiveByOrganizationAndEmail(
    organizationId: string,
    email: string,
  ): Promise<OrganizationInvitation | null>;
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
