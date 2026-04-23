import type { IPromptAggregateRepository } from "../../domain/repositories/prompt-aggregate-repository.js";
import { Prompt } from "../../domain/entities/prompt.js";
import type { InMemoryPromptQueryService } from "./in-memory-prompt-query-service.js";

export class InMemoryPromptAggregateRepository implements IPromptAggregateRepository {
  private readonly prompts = new Map<string, Prompt>();
  private nextPrompt = 1;
  private nextVersion = 1;

  // Optional read-side sink kept in step with writes, mirroring how the Mongo
  // query service reads what the aggregate repo has written.
  constructor(private readonly queryService?: InMemoryPromptQueryService) {}

  async nextPromptId(): Promise<string> {
    return `prompt-${this.nextPrompt++}`;
  }

  async nextVersionId(): Promise<string> {
    return `version-${this.nextVersion++}`;
  }

  async findById(id: string): Promise<Prompt | null> {
    return this.prompts.get(id) ?? null;
  }

  async save(prompt: Prompt): Promise<void> {
    const snapshot = prompt.toPrimitives();
    const hydrated = Prompt.hydrate(snapshot.prompt, snapshot.versions);
    this.prompts.set(prompt.id, hydrated);
    this.queryService?.seedFromAggregate(hydrated);
  }
}
