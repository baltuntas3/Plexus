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
import { violatedKeyPatternHas } from "./mongo-errors.js";
import { OrganizationModel } from "./organization-model.js";
import { runOptimisticSave } from "./optimistic-save.js";
import { getCurrentSession } from "./transaction-context.js";

interface OrganizationDocShape {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  ownerId: Types.ObjectId;
  approvalPolicy?: { requiredApprovals: number } | null;
  revision?: number;
  createdAt: Date;
  updatedAt: Date;
}

const toPrimitives = (doc: OrganizationDocShape): OrganizationPrimitives => ({
  id: String(doc._id),
  name: doc.name,
  slug: doc.slug,
  ownerId: String(doc.ownerId),
  approvalPolicy: doc.approvalPolicy ?? null,
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
    await runOptimisticSave({
      aggregate: org,
      model: OrganizationModel,
      toCreateDoc: (p) => ({
        _id: p.id,
        name: p.name,
        slug: p.slug,
        ownerId: p.ownerId,
        approvalPolicy: p.approvalPolicy,
        revision: p.revision,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }),
      toUpdateSet: (p) => ({
        name: p.name,
        slug: p.slug,
        ownerId: p.ownerId,
        approvalPolicy: p.approvalPolicy,
        revision: p.revision,
        updatedAt: p.updatedAt,
      }),
      staleError: () => OrganizationAggregateStaleError(),
      // Distinguish "another org owns this slug" from a generic id collision
      // (stale aggregate). Only the first is user-resolvable.
      onDuplicateKey: (err) =>
        violatedKeyPatternHas(err, "slug")
          ? OrganizationSlugTakenError(org.slug)
          : null,
    });
  }
}
