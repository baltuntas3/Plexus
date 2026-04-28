import { Types } from "mongoose";
import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import {
  Prompt,
  type PromptPrimitives,
} from "../../../domain/entities/prompt.js";
import { PromptAggregateStaleError } from "../../../domain/errors/domain-error.js";
import { PromptModel } from "./prompt-model.js";
import { getCurrentSession } from "./transaction-context.js";

interface PromptDocShape {
  _id: Types.ObjectId;
  name: string;
  description: string;
  taskType: PromptPrimitives["taskType"];
  ownerId: Types.ObjectId;
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
  ownerId: String(doc.ownerId),
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
  async findById(id: string): Promise<Prompt | null> {
    const session = getCurrentSession();
    const doc = await PromptModel.findById(id, null, { session }).lean<PromptDocShape>();
    return doc ? Prompt.hydrate(toPromptPrimitives(doc)) : null;
  }

  async findOwnedById(id: string, ownerId: string): Promise<Prompt | null> {
    const session = getCurrentSession();
    const doc = await PromptModel.findOne({ _id: id, ownerId }, null, {
      session,
    }).lean<PromptDocShape>();
    return doc ? Prompt.hydrate(toPromptPrimitives(doc)) : null;
  }

  async save(prompt: Prompt): Promise<void> {
    const { primitives, expectedRevision } = prompt.toSnapshot();
    const session = getCurrentSession();

    if (expectedRevision === 0) {
      try {
        await PromptModel.create(
          [
            {
              _id: primitives.id,
              name: primitives.name,
              description: primitives.description,
              taskType: primitives.taskType,
              ownerId: primitives.ownerId,
              productionVersionId: primitives.productionVersionId,
              versionCounter: primitives.versionCounter,
              revision: primitives.revision,
              createdAt: primitives.createdAt,
              updatedAt: primitives.updatedAt,
            },
          ],
          { session },
        );
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          throw PromptAggregateStaleError();
        }
        throw err;
      }
    } else {
      const result = await PromptModel.updateOne(
        { _id: primitives.id, revision: expectedRevision },
        {
          $set: {
            name: primitives.name,
            description: primitives.description,
            taskType: primitives.taskType,
            ownerId: primitives.ownerId,
            productionVersionId: primitives.productionVersionId,
            versionCounter: primitives.versionCounter,
            revision: primitives.revision,
            updatedAt: primitives.updatedAt,
          },
        },
        { session },
      );
      if (result.matchedCount === 0) {
        throw PromptAggregateStaleError();
      }
    }

    prompt.markPersisted();
  }
}

const isDuplicateKeyError = (err: unknown): boolean => {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: number }).code === 11000
  );
};
