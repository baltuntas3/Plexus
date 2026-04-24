import type { IPromptAggregateRepository } from "../../domain/repositories/prompt-aggregate-repository.js";
import { Prompt } from "../../domain/entities/prompt.js";
import { PromptAggregateStaleError } from "../../domain/errors/domain-error.js";
import type { InMemoryPromptQueryService } from "./in-memory-prompt-query-service.js";

// Test double. Mirrors the Mongo repo's snapshot/commit protocol: save
// consumes the aggregate's snapshot, gates on expected revision, rehydrates
// into storage, and commits the aggregate. No dirty-tracking — the fake
// rewrites the whole thing; the production repo is the one that diffs for
// write-volume reasons.
export class InMemoryPromptAggregateRepository implements IPromptAggregateRepository {
  private readonly prompts = new Map<string, Prompt>();
  private readonly storedRevisions = new Map<string, number>();

  constructor(private readonly queryService?: InMemoryPromptQueryService) {}

  async findById(id: string): Promise<Prompt | null> {
    return this.prompts.get(id) ?? null;
  }

  async findOwnedById(id: string, ownerId: string): Promise<Prompt | null> {
    const prompt = this.prompts.get(id);
    if (!prompt || prompt.ownerId !== ownerId) return null;
    return prompt;
  }

  async save(prompt: Prompt): Promise<void> {
    const snapshot = prompt.toSnapshot();
    const stored = this.storedRevisions.get(prompt.id);
    if (stored !== undefined && stored !== snapshot.expectedRevision) {
      throw PromptAggregateStaleError();
    }
    const hydrated = Prompt.hydrate(snapshot.root, [...snapshot.versions]);
    this.prompts.set(prompt.id, hydrated);
    this.storedRevisions.set(prompt.id, snapshot.nextRevision);
    this.queryService?.seedFromAggregate(hydrated);
    prompt.commit(snapshot);
  }
}
