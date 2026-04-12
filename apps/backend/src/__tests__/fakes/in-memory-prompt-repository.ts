import type {
  CreatePromptInput,
  IPromptRepository,
  ListPromptsQuery,
  PromptListResult,
} from "../../domain/repositories/prompt-repository.js";
import type { Prompt } from "../../domain/entities/prompt.js";

export class InMemoryPromptRepository implements IPromptRepository {
  private readonly prompts = new Map<string, Prompt>();
  private nextId = 1;

  async create(input: CreatePromptInput): Promise<Prompt> {
    const now = new Date();
    const id = String(this.nextId++);
    const prompt: Prompt = {
      id,
      name: input.name,
      description: input.description,
      taskType: input.taskType,
      ownerId: input.ownerId,
      productionVersion: null,
      createdAt: now,
      updatedAt: now,
    };
    this.prompts.set(id, prompt);
    return prompt;
  }

  async findById(id: string): Promise<Prompt | null> {
    return this.prompts.get(id) ?? null;
  }

  async list(query: ListPromptsQuery): Promise<PromptListResult> {
    const owned = [...this.prompts.values()].filter((p) => p.ownerId === query.ownerId);
    const start = (query.page - 1) * query.pageSize;
    return { items: owned.slice(start, start + query.pageSize), total: owned.length };
  }

  async setProductionVersion(promptId: string, version: string | null): Promise<void> {
    const prompt = this.prompts.get(promptId);
    if (!prompt) return;
    this.prompts.set(promptId, { ...prompt, productionVersion: version, updatedAt: new Date() });
  }
}
