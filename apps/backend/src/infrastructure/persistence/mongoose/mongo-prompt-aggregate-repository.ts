import mongoose, { Types } from "mongoose";
import type { IPromptAggregateRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import {
  Prompt,
  type PromptPrimitives,
} from "../../../domain/entities/prompt.js";
import type { PromptVersionPrimitives } from "../../../domain/entities/prompt-version.js";
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

// Stable signature over a version's persisted shape. Used by the save path
// to decide which child rows actually need to be written: immutable
// versions serialize to the same string on every save, so fork-on-edit
// pays O(1) writes per edit instead of O(|versions|). The JSON encoding
// also naturally covers the mutable metadata (name, status, updatedAt).
const versionSignature = (v: PromptVersionPrimitives): string =>
  JSON.stringify({
    v: v.version,
    n: v.name,
    p: v.parentVersionId,
    s: v.sourcePrompt,
    r: v.representation,
    st: v.status,
    u: v.updatedAt.getTime(),
  });

// Persist a Prompt aggregate atomically with optimistic concurrency. Change
// tracking lives inside the repo — the aggregate hands over a full
// snapshot, the repo diffs it against what it last hydrated to decide
// which version docs to upsert. The aggregate stays a business-rules
// object and does not expose a persistence protocol beyond
// `toSnapshot`/`commit`.
//
// Requires a replica-set or mongos deployment — `withTransaction` is not
// supported on standalone MongoDB. Local dev must run a replica set.
export class MongoPromptAggregateRepository implements IPromptAggregateRepository {
  // Per-aggregate signature cache of the last hydrated version set. Save
  // compares the outbound snapshot against this to find dirty rows. Stored
  // on the repo instance, not the aggregate, so the aggregate's public
  // surface stays free of persistence bookkeeping.
  private readonly versionSignatures = new Map<string, Map<string, string>>();

  async findById(id: string): Promise<Prompt | null> {
    const promptDoc = await PromptModel.findById(id).lean<PromptDocShape>();
    return promptDoc ? this.hydrateFromDoc(promptDoc) : null;
  }

  async findOwnedById(id: string, ownerId: string): Promise<Prompt | null> {
    const promptDoc = await PromptModel.findOne({
      _id: id,
      ownerId,
    }).lean<PromptDocShape>();
    return promptDoc ? this.hydrateFromDoc(promptDoc) : null;
  }

  async save(prompt: Prompt): Promise<void> {
    const snapshot = prompt.toSnapshot();
    const { root, versions, expectedRevision, nextRevision } = snapshot;
    const previous = this.versionSignatures.get(root.id);
    const nextSignatures = new Map<string, string>();
    const versionsToWrite: PromptVersionPrimitives[] = [];
    for (const version of versions) {
      const signature = versionSignature(version);
      nextSignatures.set(version.id, signature);
      if (previous?.get(version.id) !== signature) {
        versionsToWrite.push(version);
      }
    }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        if (expectedRevision === 0) {
          try {
            await PromptModel.create(
              [
                {
                  _id: root.id,
                  name: root.name,
                  description: root.description,
                  taskType: root.taskType,
                  ownerId: root.ownerId,
                  productionVersion: root.productionVersion,
                  versionCounter: root.versionCounter,
                  revision: nextRevision,
                  createdAt: root.createdAt,
                  updatedAt: root.updatedAt,
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
            { _id: root.id, revision: expectedRevision },
            {
              $set: {
                name: root.name,
                description: root.description,
                taskType: root.taskType,
                ownerId: root.ownerId,
                productionVersion: root.productionVersion,
                versionCounter: root.versionCounter,
                revision: nextRevision,
                updatedAt: root.updatedAt,
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

    this.versionSignatures.set(root.id, nextSignatures);
    prompt.commit(snapshot);
  }

  private async hydrateFromDoc(promptDoc: PromptDocShape): Promise<Prompt> {
    const versionDocs = await PromptVersionModel.find({
      promptId: String(promptDoc._id),
    }).lean<PromptVersionDocShape[]>();
    const primitives = versionDocs.map(toVersionPrimitives);
    this.cacheHydratedSignatures(String(promptDoc._id), primitives);
    return Prompt.hydrate(
      toPromptPrimitives(promptDoc, versionDocs.length),
      primitives,
    );
  }

  private cacheHydratedSignatures(
    promptId: string,
    versions: readonly PromptVersionPrimitives[],
  ): void {
    const map = new Map<string, string>();
    for (const version of versions) {
      map.set(version.id, versionSignature(version));
    }
    this.versionSignatures.set(promptId, map);
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
