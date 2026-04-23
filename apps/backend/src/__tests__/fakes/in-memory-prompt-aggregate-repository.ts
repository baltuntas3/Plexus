import type { IPromptAggregateRepository } from "../../domain/repositories/prompt-aggregate-repository.js";
import { Prompt } from "../../domain/entities/prompt.js";
import { PromptAggregateStaleError } from "../../domain/errors/domain-error.js";
import type { InMemoryPromptQueryService } from "./in-memory-prompt-query-service.js";

// Test double. Mirrors the Mongo repo's optimistic concurrency and commit
// protocol: save takes a snapshot, checks the expected revision against the
// stored one, advances, and then `commit`s the aggregate.
export class InMemoryPromptAggregateRepository implements IPromptAggregateRepository {
  private readonly prompts = new Map<string, Prompt>();
  private readonly storedRevisions = new Map<string, number>();

  constructor(private readonly queryService?: InMemoryPromptQueryService) {}

  async findById(id: string): Promise<Prompt | null> {
    return this.prompts.get(id) ?? null;
  }

  async save(prompt: Prompt): Promise<void> {
    const snapshot = prompt.toSnapshot();
    const stored = this.storedRevisions.get(prompt.id);
    if (stored !== undefined && stored !== snapshot.expectedRevision) {
      throw PromptAggregateStaleError();
    }
    const hydrated = Prompt.hydrate(snapshot.prompt, [...snapshot.versions]);
    this.prompts.set(prompt.id, hydrated);
    this.storedRevisions.set(prompt.id, snapshot.nextRevision);
    this.queryService?.seedFromAggregate(hydrated);
    prompt.commit(snapshot);
  }
}
