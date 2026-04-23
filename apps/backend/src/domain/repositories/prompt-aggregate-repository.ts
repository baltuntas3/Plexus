import type { Prompt } from "../entities/prompt.js";

export interface IPromptAggregateRepository {
  findById(id: string): Promise<Prompt | null>;
  // save advances the aggregate's revision on success and throws
  // PromptAggregateStaleError when the optimistic-concurrency check fails.
  save(prompt: Prompt): Promise<void>;
}
