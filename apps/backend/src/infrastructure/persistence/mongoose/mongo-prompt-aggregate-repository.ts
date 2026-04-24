import mongoose, { Types } from "mongoose";
import type { IPromptAggregateRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import {
  Prompt,
  type PromptPrimitives,
} from "../../../domain/entities/prompt.js";
import { PromptAggregateStaleError } from "../../../domain/errors/domain-error.js";
import { PromptModel } from "./prompt-model.js";
import { PromptVersionModel } from "./prompt-version-model.js";
import {
  toVersionDocSet,
  toVersionPrimitives,
  type PromptVersionDocShape,
} from "./prompt-version-mongo-mapper.js";

interface PromptDocShape {
  _id: Types.ObjectId;
  name: string;
  description: string;
  taskType: PromptPrimitives["taskType"];
  ownerId: Types.ObjectId;
  productionVersion: string | null;
  versionCounter?: number;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

const toPromptPrimitives = (
  doc: PromptDocShape,
  versionCount: number,
): PromptPrimitives => ({
  id: String(doc._id),
  name: doc.name,
  description: doc.description,
  taskType: doc.taskType,
  ownerId: String(doc.ownerId),
  productionVersion: doc.productionVersion,
  versionCounter: doc.versionCounter ?? versionCount,
  revision: doc.revision ?? 0,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

// Persist a Prompt aggregate atomically with optimistic concurrency. The
// aggregate tracks which version ids are dirty; this repo drains that set
// and upserts only those documents, so a prompt with hundreds of immutable
// historical versions does not pay an O(|versions|) write per edit.
//
// Requires a replica-set or mongos deployment — `withTransaction` is not
// supported on standalone MongoDB. Local dev must run a replica set.
export class MongoPromptAggregateRepository implements IPromptAggregateRepository {
  async findById(id: string): Promise<Prompt | null> {
    const promptDoc = await PromptModel.findById(id).lean<PromptDocShape>();
    if (!promptDoc) {
      return null;
    }
    const versionDocs = await PromptVersionModel.find({ promptId: id }).lean<
      PromptVersionDocShape[]
    >();
    return Prompt.hydrate(
      toPromptPrimitives(promptDoc, versionDocs.length),
      versionDocs.map(toVersionPrimitives),
    );
  }

  async save(prompt: Prompt): Promise<void> {
    const dirtyVersionIds = new Set(prompt.pullDirtyVersionIds());
    const rootState = prompt.toPrimitives();
    const versions = prompt.versionPrimitives();
    const expectedRevision = rootState.revision;
    const nextRevision = expectedRevision + 1;

    const versionsToWrite = versions.filter((version) =>
      dirtyVersionIds.has(version.id),
    );

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        if (expectedRevision === 0) {
          try {
            await PromptModel.create(
              [
                {
                  _id: rootState.id,
                  name: rootState.name,
                  description: rootState.description,
                  taskType: rootState.taskType,
                  ownerId: rootState.ownerId,
                  productionVersion: rootState.productionVersion,
                  versionCounter: rootState.versionCounter,
                  revision: nextRevision,
                  createdAt: rootState.createdAt,
                  updatedAt: rootState.updatedAt,
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
            { _id: rootState.id, revision: expectedRevision },
            {
              $set: {
                name: rootState.name,
                description: rootState.description,
                taskType: rootState.taskType,
                ownerId: rootState.ownerId,
                productionVersion: rootState.productionVersion,
                versionCounter: rootState.versionCounter,
                revision: nextRevision,
                updatedAt: rootState.updatedAt,
              },
            },
            { session },
          );
          if (result.matchedCount === 0) {
            throw PromptAggregateStaleError();
          }
        }

        for (const version of versionsToWrite) {
          await PromptVersionModel.updateOne(
            { _id: version.id },
            { $set: toVersionDocSet(version) },
            { upsert: true, session },
          );
        }
      });
    } finally {
      await session.endSession();
    }

    prompt.markPersisted(nextRevision);
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
