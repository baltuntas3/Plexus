import { Types } from "mongoose";
import type { IOrganizationMemberRepository } from "../../../domain/repositories/organization-member-repository.js";
import {
  OrganizationMember,
  type OrganizationMemberPrimitives,
} from "../../../domain/entities/organization-member.js";
import { OrganizationMemberAggregateStaleError } from "../../../domain/errors/domain-error.js";
import { isDuplicateKeyError } from "./mongo-errors.js";
import { OrganizationMemberModel } from "./organization-member-model.js";
import { getCurrentSession } from "./transaction-context.js";

interface MemberDocShape {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  role: OrganizationMemberPrimitives["role"];
  invitedBy: Types.ObjectId | null;
  joinedAt: Date;
  revision?: number;
}

const toPrimitives = (doc: MemberDocShape): OrganizationMemberPrimitives => ({
  id: String(doc._id),
  organizationId: String(doc.organizationId),
  userId: String(doc.userId),
  role: doc.role,
  invitedBy: doc.invitedBy ? String(doc.invitedBy) : null,
  joinedAt: doc.joinedAt,
  revision: doc.revision ?? 0,
});

export class MongoOrganizationMemberRepository
  implements IOrganizationMemberRepository
{
  async findById(id: string): Promise<OrganizationMember | null> {
    const session = getCurrentSession();
    const doc = await OrganizationMemberModel.findById(id, null, {
      session,
    }).lean<MemberDocShape>();
    return doc ? OrganizationMember.hydrate(toPrimitives(doc)) : null;
  }

  async findByOrganizationAndUser(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMember | null> {
    const session = getCurrentSession();
    const doc = await OrganizationMemberModel.findOne(
      { organizationId, userId },
      null,
      { session },
    ).lean<MemberDocShape>();
    return doc ? OrganizationMember.hydrate(toPrimitives(doc)) : null;
  }

  async listByOrganization(organizationId: string): Promise<OrganizationMember[]> {
    const session = getCurrentSession();
    const docs = await OrganizationMemberModel.find({ organizationId }, null, {
      session,
    })
      .sort({ joinedAt: 1 })
      .lean<MemberDocShape[]>();
    return docs.map((d) => OrganizationMember.hydrate(toPrimitives(d)));
  }

  async listByUser(userId: string): Promise<OrganizationMember[]> {
    const session = getCurrentSession();
    const docs = await OrganizationMemberModel.find({ userId }, null, {
      session,
    })
      .sort({ joinedAt: 1 })
      .lean<MemberDocShape[]>();
    return docs.map((d) => OrganizationMember.hydrate(toPrimitives(d)));
  }

  async save(member: OrganizationMember): Promise<void> {
    const { primitives, expectedRevision } = member.toSnapshot();
    const session = getCurrentSession();

    if (expectedRevision === 0) {
      try {
        await OrganizationMemberModel.create(
          [
            {
              _id: primitives.id,
              organizationId: primitives.organizationId,
              userId: primitives.userId,
              role: primitives.role,
              invitedBy: primitives.invitedBy,
              joinedAt: primitives.joinedAt,
              revision: primitives.revision,
            },
          ],
          { session },
        );
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          // (org, user) is unique; a duplicate means a concurrent invite
          // accepted twice — treat as stale and let the caller retry.
          throw OrganizationMemberAggregateStaleError();
        }
        throw err;
      }
    } else {
      const result = await OrganizationMemberModel.updateOne(
        { _id: primitives.id, revision: expectedRevision },
        {
          $set: {
            role: primitives.role,
            invitedBy: primitives.invitedBy,
            revision: primitives.revision,
          },
        },
        { session },
      );
      if (result.matchedCount === 0) {
        throw OrganizationMemberAggregateStaleError();
      }
    }

    member.markPersisted();
  }

  async remove(id: string): Promise<void> {
    const session = getCurrentSession();
    await OrganizationMemberModel.deleteOne({ _id: id }, { session });
  }
}
