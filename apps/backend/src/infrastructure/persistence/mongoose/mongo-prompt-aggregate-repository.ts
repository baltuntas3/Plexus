import { Types } from "mongoose";
import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import {
  Prompt,
  type PromptPrimitives,
} from "../../../domain/entities/prompt.js";
import { PromptAggregateStaleError } from "../../../domain/errors/domain-error.js";
import { PromptModel } from "./prompt-model.js";
import { runOptimisticSave } from "./optimistic-save.js";
import { getCurrentSession } from "./transaction-context.js";

interface PromptDocShape {
  _id: Types.ObjectId;
  name: string;
  description: string;
  taskType: PromptPrimitives["taskType"];
  organizationId: Types.ObjectId;
  creatorId: Types.ObjectId;
  productionVersionId: Types.ObjectId | null;
  versionCounter?: number;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

const toPromptPrimitives = (doc: PromptDocShape): PromptPrimitives => ({
  id: String(doc._id),
  name: doc.name,
  description: doc.description,
  taskType: doc.taskType,
  organizationId: String(doc.organizationId),
  creatorId: String(doc.creatorId),
  productionVersionId: doc.productionVersionId
    ? String(doc.productionVersionId)
    : null,
  versionCounter: doc.versionCounter ?? 0,
  revision: doc.revision ?? 0,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

// Persists the Prompt aggregate root. Version documents are owned by a
// separate repository — a save here is a single-document write and does
// not touch the version collection.
export class MongoPromptAggregateRepository implements IPromptRepository {
  async findInOrganization(
    id: string,
    organizationId: string,
  ): Promise<Prompt | null> {
    const session = getCurrentSession();
    const doc = await PromptModel.findOne(
      { _id: id, organizationId },
      null,
      { session },
    ).lean<PromptDocShape>();
    return doc ? Prompt.hydrate(toPromptPrimitives(doc)) : null;
  }

  async save(prompt: Prompt): Promise<void> {
    await runOptimisticSave({
      aggregate: prompt,
      model: PromptModel,
      toCreateDoc: (p) => ({
        _id: p.id,
        name: p.name,
        description: p.description,
        taskType: p.taskType,
        organizationId: p.organizationId,
        creatorId: p.creatorId,
        productionVersionId: p.productionVersionId,
        versionCounter: p.versionCounter,
        revision: p.revision,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }),
      toUpdateSet: (p) => ({
        name: p.name,
        description: p.description,
        taskType: p.taskType,
        organizationId: p.organizationId,
        creatorId: p.creatorId,
        productionVersionId: p.productionVersionId,
        versionCounter: p.versionCounter,
        revision: p.revision,
        updatedAt: p.updatedAt,
      }),
      staleError: () => PromptAggregateStaleError(),
    });
  }
}
