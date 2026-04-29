import type { OrganizationMembershipEvent } from "../entities/organization-membership-event.js";

// Append-only audit log port. No `update`/`delete` — once written, the
// row is immutable. Use cases hand a freshly-built event in; the
// repository persists it inside the same UoW as the membership change
// it records, so partial state ("role changed but no audit row") is
// impossible.
export interface IOrganizationMembershipEventRepository {
  append(event: OrganizationMembershipEvent): Promise<void>;
  // Reverse-chronological listing used by the UI's "Geçmiş" timeline.
  // Pagination is the caller's concern; this returns the full list
  // since current orgs have small membership churn.
  listByOrganization(
    organizationId: string,
  ): Promise<OrganizationMembershipEvent[]>;
}
