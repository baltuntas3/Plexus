import type { IOrganizationInvitationRepository } from "../../domain/repositories/organization-invitation-repository.js";
import {
  OrganizationInvitation,
  type OrganizationInvitationPrimitives,
} from "../../domain/entities/organization-invitation.js";
import {
  OrganizationInvitationAggregateStaleError,
  OrganizationInvitationAlreadyPendingError,
} from "../../domain/errors/domain-error.js";

// Mirrors the Mongo repo: enforces both unique indexes (tokenHash global,
// `(orgId, email)` partial-on-pending) so use-case tests catch the same
// concurrency edges integration tests would.
export class InMemoryOrganizationInvitationRepository
  implements IOrganizationInvitationRepository
{
  private readonly invitations = new Map<
    string,
    OrganizationInvitationPrimitives
  >();

  async findById(id: string): Promise<OrganizationInvitation | null> {
    const data = this.invitations.get(id);
    return data ? OrganizationInvitation.hydrate({ ...data }) : null;
  }

  async findByTokenHash(
    tokenHash: string,
  ): Promise<OrganizationInvitation | null> {
    for (const data of this.invitations.values()) {
      if (data.tokenHash === tokenHash) {
        return OrganizationInvitation.hydrate({ ...data });
      }
    }
    return null;
  }

  async listByOrganization(
    organizationId: string,
  ): Promise<OrganizationInvitation[]> {
    return Array.from(this.invitations.values())
      .filter((d) => d.organizationId === organizationId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((d) => OrganizationInvitation.hydrate({ ...d }));
  }

  async save(invitation: OrganizationInvitation): Promise<void> {
    const { primitives, expectedRevision } = invitation.toSnapshot();
    const stored = this.invitations.get(primitives.id);

    if (expectedRevision === 0) {
      if (stored) {
        throw OrganizationInvitationAggregateStaleError();
      }
      // Token hash uniqueness — global.
      for (const other of this.invitations.values()) {
        if (other.tokenHash === primitives.tokenHash) {
          throw OrganizationInvitationAggregateStaleError();
        }
      }
      // Partial unique on `(orgId, email)` where status="pending".
      if (primitives.status === "pending") {
        for (const other of this.invitations.values()) {
          if (
            other.organizationId === primitives.organizationId &&
            other.email === primitives.email &&
            other.status === "pending"
          ) {
            throw OrganizationInvitationAlreadyPendingError();
          }
        }
      }
      this.invitations.set(primitives.id, { ...primitives });
    } else {
      if (!stored || stored.revision !== expectedRevision) {
        throw OrganizationInvitationAggregateStaleError();
      }
      this.invitations.set(primitives.id, { ...primitives });
    }

    invitation.markPersisted();
  }
}
