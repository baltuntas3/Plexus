import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import { PromptVersion } from "../../../domain/entities/prompt-version.js";
import { PromptVersionAggregateStaleError } from "../../../domain/errors/domain-error.js";
import { PromptVersionModel } from "./prompt-version-model.js";
import {
  toVersionDocSet,
  toVersionPrimitives,
  type PromptVersionDocShape,
} from "./prompt-version-mongo-mapper.js";
import { getCurrentSession } from "./transaction-context.js";

// Persists the PromptVersion aggregate. Each save is a single-document
// write with optimistic concurrency on `revision` — the aggregate's
// snapshot carries the pre-save revision, the write is gated on it, and
// the aggregate is committed only on a successful match.
export class MongoPromptVersionRepository implements IPromptVersionRepository {
  async findById(id: string): Promise<PromptVersion | null> {
    const session = getCurrentSession();
    const doc = await PromptVersionModel.findById(id, null, {
      session,
    }).lean<PromptVersionDocShape>();
    return doc ? PromptVersion.hydrate(toVersionPrimitives(doc)) : null;
  }

  async findByPromptAndLabel(
    promptId: string,
    label: string,
  ): Promise<PromptVersion | null> {
    const session = getCurrentSession();
    const doc = await PromptVersionModel.findOne(
      { promptId, version: label },
      null,
      { session },
    ).lean<PromptVersionDocShape>();
    return doc ? PromptVersion.hydrate(toVersionPrimitives(doc)) : null;
  }

  async save(version: PromptVersion): Promise<void> {
    const { primitives, expectedRevision } = version.toSnapshot();
    const docSet = toVersionDocSet(primitives);
    const session = getCurrentSession();

    if (expectedRevision === 0) {
      try {
        await PromptVersionModel.create([{ _id: primitives.id, ...docSet }], { session });
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          throw PromptVersionAggregateStaleError();
        }
        throw err;
      }
    } else {
      const result = await PromptVersionModel.updateOne(
        { _id: primitives.id, revision: expectedRevision },
        { $set: docSet },
        { session },
      );
      if (result.matchedCount === 0) {
        throw PromptVersionAggregateStaleError();
      }
    }

    version.markPersisted();
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
