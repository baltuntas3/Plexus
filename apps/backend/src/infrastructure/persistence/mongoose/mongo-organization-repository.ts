import { Types } from "mongoose";
import type { IOrganizationRepository } from "../../../domain/repositories/organization-repository.js";
import {
  Organization,
  type OrganizationPrimitives,
} from "../../../domain/entities/organization.js";
import {
  OrganizationAggregateStaleError,
  OrganizationSlugTakenError,
} from "../../../domain/errors/domain-error.js";
import {
  isDuplicateKeyError,
  violatedKeyPatternHas,
} from "./mongo-errors.js";
import { OrganizationModel } from "./organization-model.js";
import { getCurrentSession } from "./transaction-context.js";

interface OrganizationDocShape {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  ownerId: Types.ObjectId;
  revision?: number;
  createdAt: Date;
  updatedAt: Date;
}

const toPrimitives = (doc: OrganizationDocShape): OrganizationPrimitives => ({
  id: String(doc._id),
  name: doc.name,
  slug: doc.slug,
  ownerId: String(doc.ownerId),
  revision: doc.revision ?? 0,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

export class MongoOrganizationRepository implements IOrganizationRepository {
  async findById(id: string): Promise<Organization | null> {
    const session = getCurrentSession();
    const doc = await OrganizationModel.findById(id, null, {
      session,
    }).lean<OrganizationDocShape>();
    return doc ? Organization.hydrate(toPrimitives(doc)) : null;
  }

  async findBySlug(slug: string): Promise<Organization | null> {
    const session = getCurrentSession();
    const doc = await OrganizationModel.findOne({ slug }, null, {
      session,
    }).lean<OrganizationDocShape>();
    return doc ? Organization.hydrate(toPrimitives(doc)) : null;
  }

  async save(org: Organization): Promise<void> {
    const { primitives, expectedRevision } = org.toSnapshot();
    const session = getCurrentSession();

    if (expectedRevision === 0) {
      try {
        await OrganizationModel.create(
          [
            {
              _id: primitives.id,
              name: primitives.name,
              slug: primitives.slug,
              ownerId: primitives.ownerId,
              revision: primitives.revision,
              createdAt: primitives.createdAt,
              updatedAt: primitives.updatedAt,
            },
          ],
          { session },
        );
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          // Distinguish "this id already exists" (stale aggregate) from
          // "another org owns this slug" — the second is the only one a
          // user can resolve and benefits from a specific message.
          if (violatedKeyPatternHas(err, "slug")) {
            throw OrganizationSlugTakenError(primitives.slug);
          }
          throw OrganizationAggregateStaleError();
        }
        throw err;
      }
    } else {
      const result = await OrganizationModel.updateOne(
        { _id: primitives.id, revision: expectedRevision },
        {
          $set: {
            name: primitives.name,
            slug: primitives.slug,
            ownerId: primitives.ownerId,
            revision: primitives.revision,
            updatedAt: primitives.updatedAt,
          },
        },
        { session },
      );
      if (result.matchedCount === 0) {
        throw OrganizationAggregateStaleError();
      }
    }

    org.markPersisted();
  }
}
