import mongoose, { Types } from "mongoose";
import type { IPromptAggregateRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import { Prompt, type PromptPrimitives } from "../../../domain/entities/prompt.js";
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
  productionVersion: doc.productionVersion,
  // Older docs predating the concurrency field are treated as revision 0.
  revision: doc.revision ?? 0,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

// Persist a Prompt aggregate atomically with optimistic concurrency. One
// MongoDB session covers the root and all its versions so a mid-write
// failure cannot leave the aggregate half-written, and the prompt update is
// gated on the expected revision so a concurrent writer that advanced the
// revision first will cause this save to throw PromptAggregateStaleError.
//
// Requires a replica-set or mongos deployment (transactions are unsupported
// on standalone MongoDB). Local dev must use a replica set configuration.
export class MongoPromptAggregateRepository implements IPromptAggregateRepository {
  async findById(id: string): Promise<Prompt | null> {
    const promptDoc = await PromptModel.findById(id).lean<PromptDocShape>();
    if (!promptDoc) {
      return null;
    }
    // No sort clause here: Prompt.hydrate enforces creation-order as an
    // aggregate invariant, so the DB query stays driver-order and saves a
    // redundant in-memory resort.
    const versionDocs = await PromptVersionModel.find({ promptId: id }).lean<
      PromptVersionDocShape[]
    >();
    return Prompt.hydrate(
      toPromptPrimitives(promptDoc),
      versionDocs.map(toVersionPrimitives),
    );
  }

  async save(prompt: Prompt): Promise<void> {
    const snapshot = prompt.toSnapshot();
    const { prompt: promptState, versions, expectedRevision, nextRevision } = snapshot;

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        if (expectedRevision === 0) {
          // New aggregate — insert fresh. A duplicate-key error here means a
          // concurrent writer already created the prompt; surface it as
          // stale rather than a generic mongo error.
          try {
            await PromptModel.create(
              [
                {
                  _id: promptState.id,
                  name: promptState.name,
                  description: promptState.description,
                  taskType: promptState.taskType,
                  ownerId: promptState.ownerId,
                  productionVersion: promptState.productionVersion,
                  revision: nextRevision,
                  createdAt: promptState.createdAt,
                  updatedAt: promptState.updatedAt,
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
          // Existing aggregate — gate the update on the expected revision.
          // matchedCount === 0 means another writer advanced the aggregate
          // since we loaded it; reject the write so the caller can reload.
          const result = await PromptModel.updateOne(
            { _id: promptState.id, revision: expectedRevision },
            {
              $set: {
                name: promptState.name,
                description: promptState.description,
                taskType: promptState.taskType,
                ownerId: promptState.ownerId,
                productionVersion: promptState.productionVersion,
                revision: nextRevision,
                updatedAt: promptState.updatedAt,
              },
            },
            { session },
          );
          if (result.matchedCount === 0) {
            throw PromptAggregateStaleError();
          }
        }

        for (const version of versions) {
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

    // Advance the aggregate's loaded revision to match what we just wrote.
    // Using the snapshot (rather than a plain `markPersisted()` with no
    // arguments) makes this a typed, single-use token — the commit fails
    // loudly if it is applied to a different aggregate instance than the
    // one the snapshot was taken from.
    prompt.commit(snapshot);
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
