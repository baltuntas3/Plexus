import type { IOrganizationMembershipEventRepository } from "../../domain/repositories/organization-membership-event-repository.js";
import {
  OrganizationMembershipEvent,
  type OrganizationMembershipEventPrimitives,
} from "../../domain/entities/organization-membership-event.js";

// Append-only mirror of the Mongo repo. Tests use this to assert "did
// the use case write the audit row?" without standing up a real db.
export class InMemoryOrganizationMembershipEventRepository
  implements IOrganizationMembershipEventRepository
{
  private readonly events: OrganizationMembershipEventPrimitives[] = [];

  async append(event: OrganizationMembershipEvent): Promise<void> {
    this.events.push(event.toPrimitives());
  }

  async listByOrganization(
    organizationId: string,
  ): Promise<OrganizationMembershipEvent[]> {
    return this.events
      .filter((e) => e.organizationId === organizationId)
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .map((e) => OrganizationMembershipEvent.hydrate({ ...e }));
  }

  // Test-only helper for terse assertions.
  all(): OrganizationMembershipEventPrimitives[] {
    return [...this.events];
  }
}
