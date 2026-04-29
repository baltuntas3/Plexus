import type { IOrganizationMemberRepository } from "../../domain/repositories/organization-member-repository.js";
import {
  OrganizationMember,
  type OrganizationMemberPrimitives,
} from "../../domain/entities/organization-member.js";
import { OrganizationMemberAggregateStaleError } from "../../domain/errors/domain-error.js";

// Test double for `MongoOrganizationMemberRepository`. Enforces the unique
// (organizationId, userId) compound index so an attempt to add the same
// user twice surfaces the same domain error path Mongo would return.
export class InMemoryOrganizationMemberRepository
  implements IOrganizationMemberRepository
{
  private readonly members = new Map<string, OrganizationMemberPrimitives>();

  async findById(id: string): Promise<OrganizationMember | null> {
    const data = this.members.get(id);
    return data ? OrganizationMember.hydrate({ ...data }) : null;
  }

  async findByOrganizationAndUser(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMember | null> {
    for (const data of this.members.values()) {
      if (data.organizationId === organizationId && data.userId === userId) {
        return OrganizationMember.hydrate({ ...data });
      }
    }
    return null;
  }

  async listByOrganization(organizationId: string): Promise<OrganizationMember[]> {
    return Array.from(this.members.values())
      .filter((m) => m.organizationId === organizationId)
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())
      .map((m) => OrganizationMember.hydrate({ ...m }));
  }

  async listByUser(userId: string): Promise<OrganizationMember[]> {
    return Array.from(this.members.values())
      .filter((m) => m.userId === userId)
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())
      .map((m) => OrganizationMember.hydrate({ ...m }));
  }

  async save(member: OrganizationMember): Promise<void> {
    const { primitives, expectedRevision } = member.toSnapshot();
    const stored = this.members.get(primitives.id);

    if (expectedRevision === 0) {
      if (stored) {
        throw OrganizationMemberAggregateStaleError();
      }
      // Reject duplicate (org, user) pairing.
      const existingPair = await this.findByOrganizationAndUser(
        primitives.organizationId,
        primitives.userId,
      );
      if (existingPair) {
        throw OrganizationMemberAggregateStaleError();
      }
      this.members.set(primitives.id, { ...primitives });
    } else {
      if (!stored || stored.revision !== expectedRevision) {
        throw OrganizationMemberAggregateStaleError();
      }
      this.members.set(primitives.id, { ...primitives });
    }

    member.markPersisted();
  }

  async remove(id: string): Promise<void> {
    this.members.delete(id);
  }
}
