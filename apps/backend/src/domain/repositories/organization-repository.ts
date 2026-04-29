import type { Organization } from "../entities/organization.js";

// Write-side port for the Organization aggregate. Slug-by-slug lookup is
// part of the domain port (not just an infrastructure helper) because slug
// uniqueness is a domain invariant — `RegisterOrganization` checks for a
// collision before persisting so the user gets a meaningful error rather
// than an opaque duplicate-key surface.
export interface IOrganizationRepository {
  findById(id: string): Promise<Organization | null>;
  findBySlug(slug: string): Promise<Organization | null>;
  // Persists the aggregate. Throws OrganizationSlugTakenError on slug
  // collision (initial create) and OrganizationAggregateStaleError on
  // optimistic-concurrency failure (subsequent saves).
  save(org: Organization): Promise<void>;
}
