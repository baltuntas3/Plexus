import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import { PromptVersion } from "../../../domain/entities/prompt-version.js";
import { PromptVersionAggregateStaleError } from "../../../domain/errors/domain-error.js";
import { PromptVersionModel } from "./prompt-version-model.js";
import {
  toVersionDocSet,
  toVersionPrimitives,
  type PromptVersionDocShape,
} from "./prompt-version-mongo-mapper.js";

// Persists the PromptVersion aggregate. Each save is a single-document
// write with optimistic concurrency on `revision` — the aggregate's
// snapshot carries the pre-save revision, the write is gated on it, and
// the aggregate is committed only on a successful match.
export class MongoPromptVersionRepository implements IPromptVersionRepository {
  async findById(id: string): Promise<PromptVersion | null> {
    const doc = await PromptVersionModel.findById(id).lean<PromptVersionDocShape>();
    return doc ? PromptVersion.hydrate(toVersionPrimitives(doc)) : null;
  }

  async findByPromptAndLabel(
    promptId: string,
    label: string,
  ): Promise<PromptVersion | null> {
    const doc = await PromptVersionModel.findOne({
      promptId,
      version: label,
    }).lean<PromptVersionDocShape>();
    return doc ? PromptVersion.hydrate(toVersionPrimitives(doc)) : null;
  }

  async save(version: PromptVersion): Promise<void> {
    const snapshot = version.toSnapshot();
    const { state, expectedRevision, nextRevision } = snapshot;
    const docSet = toVersionDocSet(state);

    if (expectedRevision === 0) {
      try {
        await PromptVersionModel.create({ _id: state.id, ...docSet });
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          throw PromptVersionAggregateStaleError();
        }
        throw err;
      }
    } else {
      const result = await PromptVersionModel.updateOne(
        { _id: state.id, revision: expectedRevision },
        { $set: { ...docSet, revision: nextRevision } },
      );
      if (result.matchedCount === 0) {
        throw PromptVersionAggregateStaleError();
      }
    }

    version.commit(snapshot);
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
