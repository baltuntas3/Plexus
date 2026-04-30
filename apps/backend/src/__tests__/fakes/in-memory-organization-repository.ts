import type { IOrganizationRepository } from "../../domain/repositories/organization-repository.js";
import {
  Organization,
  type OrganizationPrimitives,
} from "../../domain/entities/organization.js";
import {
  OrganizationAggregateStaleError,
  OrganizationSlugTakenError,
} from "../../domain/errors/domain-error.js";
import { assertOptimisticConcurrency } from "./assert-optimistic-concurrency.js";

// Test double mirroring `MongoOrganizationRepository`: enforces slug
// uniqueness and the optimistic-concurrency revision guard so use case
// tests catch the same edge cases unit tests would otherwise skip.
export class InMemoryOrganizationRepository implements IOrganizationRepository {
  private readonly orgs = new Map<string, OrganizationPrimitives>();
  private readonly slugIndex = new Map<string, string>();

  async findById(id: string): Promise<Organization | null> {
    const data = this.orgs.get(id);
    return data ? Organization.hydrate({ ...data }) : null;
  }

  async findBySlug(slug: string): Promise<Organization | null> {
    const id = this.slugIndex.get(slug);
    if (!id) return null;
    const data = this.orgs.get(id);
    return data ? Organization.hydrate({ ...data }) : null;
  }

  async save(org: Organization): Promise<void> {
    const { primitives, expectedRevision } = org.toSnapshot();
    const stored = this.orgs.get(primitives.id);

    // Slug uniqueness is the org-specific invariant on top of the shared
    // optimistic-concurrency check; both creates and slug-changing updates
    // need to reject collisions from a different aggregate.
    const slugOwner = this.slugIndex.get(primitives.slug);
    if (slugOwner && slugOwner !== primitives.id) {
      throw OrganizationSlugTakenError(primitives.slug);
    }

    assertOptimisticConcurrency(
      stored?.revision,
      expectedRevision,
      OrganizationAggregateStaleError,
    );

    if (stored && stored.slug !== primitives.slug) {
      this.slugIndex.delete(stored.slug);
    }
    this.orgs.set(primitives.id, { ...primitives });
    this.slugIndex.set(primitives.slug, primitives.id);

    org.markPersisted();
  }
}
