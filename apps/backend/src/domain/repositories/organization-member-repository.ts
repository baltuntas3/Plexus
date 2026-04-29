import type { OrganizationMember } from "../entities/organization-member.js";

// Write-side port for OrganizationMember rows. The pairings are a flat
// collection — one row per (org × user) — and authorization middleware
// depends on `findByOrganizationAndUser` for every authenticated request,
// so that lookup must hit a unique compound index in the implementation.
export interface IOrganizationMemberRepository {
  findById(id: string): Promise<OrganizationMember | null>;
  findByOrganizationAndUser(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMember | null>;
  // Used by org settings UI ("members tab") and by the authorization
  // layer when it needs to enumerate roles (e.g. listing approvers).
  listByOrganization(organizationId: string): Promise<OrganizationMember[]>;
  // Used by org switcher / user profile to enumerate orgs the user
  // belongs to.
  listByUser(userId: string): Promise<OrganizationMember[]>;
  save(member: OrganizationMember): Promise<void>;
  // Hard-deletes a membership. The user's authored content
  // (`Prompt.creatorId` etc.) is preserved by design — only access is
  // revoked, the audit trail stays intact.
  remove(id: string): Promise<void>;
}
