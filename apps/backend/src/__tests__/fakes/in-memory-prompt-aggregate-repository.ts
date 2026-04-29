import type { IPromptRepository } from "../../domain/repositories/prompt-aggregate-repository.js";
import { Prompt } from "../../domain/entities/prompt.js";
import { PromptAggregateStaleError } from "../../domain/errors/domain-error.js";
import type { InMemoryPromptQueryService } from "./in-memory-prompt-query-service.js";

// Test double for the Prompt root repository. Snapshot/commit protocol
// mirrors the Mongo repo: the snapshot's expected revision gates the
// write, the stored copy is rehydrated, the aggregate's cursor is
// advanced only on success.
export class InMemoryPromptAggregateRepository implements IPromptRepository {
  private readonly prompts = new Map<string, Prompt>();
  private readonly storedRevisions = new Map<string, number>();

  constructor(private readonly queryService?: InMemoryPromptQueryService) {}

  async findById(id: string): Promise<Prompt | null> {
    return this.prompts.get(id) ?? null;
  }

  async findInOrganization(
    id: string,
    organizationId: string,
  ): Promise<Prompt | null> {
    const prompt = this.prompts.get(id);
    if (!prompt || prompt.organizationId !== organizationId) return null;
    return prompt;
  }

  async save(prompt: Prompt): Promise<void> {
    const { primitives, expectedRevision } = prompt.toSnapshot();
    const stored = this.storedRevisions.get(prompt.id);
    if (stored !== undefined && stored !== expectedRevision) {
      throw PromptAggregateStaleError();
    }
    const hydrated = Prompt.hydrate(primitives);
    this.prompts.set(prompt.id, hydrated);
    this.storedRevisions.set(prompt.id, primitives.revision);
    this.queryService?.seedPromptRoot(hydrated);
    prompt.markPersisted();
  }
}
