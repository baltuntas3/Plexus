import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import { PromptVersion } from "../../../domain/entities/prompt-version.js";
import { PromptVersionAggregateStaleError } from "../../../domain/errors/domain-error.js";
import { isDuplicateKeyError } from "./mongo-errors.js";
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
//
// All read methods filter by `organizationId` directly (defense-in-depth):
// the version doc carries the denormalised tenant id, so a lookup with a
// foreign org returns null without consulting the Prompt root.
export class MongoPromptVersionRepository implements IPromptVersionRepository {
  async findInOrganization(
    id: string,
    organizationId: string,
  ): Promise<PromptVersion | null> {
    const session = getCurrentSession();
    const doc = await PromptVersionModel.findOne(
      { _id: id, organizationId },
      null,
      { session },
    ).lean<PromptVersionDocShape>();
    return doc ? PromptVersion.hydrate(toVersionPrimitives(doc)) : null;
  }

  async findByPromptAndLabelInOrganization(
    promptId: string,
    label: string,
    organizationId: string,
  ): Promise<PromptVersion | null> {
    const session = getCurrentSession();
    const doc = await PromptVersionModel.findOne(
      { promptId, version: label, organizationId },
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
