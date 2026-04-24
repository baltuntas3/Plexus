import type { IPromptAggregateRepository } from "../../domain/repositories/prompt-aggregate-repository.js";
import { Prompt } from "../../domain/entities/prompt.js";
import { PromptAggregateStaleError } from "../../domain/errors/domain-error.js";
import type { InMemoryPromptQueryService } from "./in-memory-prompt-query-service.js";

// Test double. Mirrors the Mongo repo's optimistic concurrency and dirty-id
// drain: save empties the aggregate's dirty set (so a retry does not
// double-count), gates the write on the expected revision, rewrites the
// store with a fresh hydrate, and advances the aggregate.
export class InMemoryPromptAggregateRepository implements IPromptAggregateRepository {
  private readonly prompts = new Map<string, Prompt>();
  private readonly storedRevisions = new Map<string, number>();

  constructor(private readonly queryService?: InMemoryPromptQueryService) {}

  async findById(id: string): Promise<Prompt | null> {
    return this.prompts.get(id) ?? null;
  }

  async save(prompt: Prompt): Promise<void> {
    prompt.pullDirtyVersionIds();
    const expectedRevision = prompt.revision;
    const stored = this.storedRevisions.get(prompt.id);
    if (stored !== undefined && stored !== expectedRevision) {
      throw PromptAggregateStaleError();
    }
    const nextRevision = expectedRevision + 1;
    const hydrated = Prompt.hydrate(prompt.toPrimitives(), [
      ...prompt.versionPrimitives(),
    ]);
    hydrated.markPersisted(nextRevision);
    this.prompts.set(prompt.id, hydrated);
    this.storedRevisions.set(prompt.id, nextRevision);
    this.queryService?.seedFromAggregate(hydrated);
    prompt.markPersisted(nextRevision);
  }
}
