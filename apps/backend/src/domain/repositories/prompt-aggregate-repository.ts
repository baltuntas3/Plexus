import type { Prompt } from "../entities/prompt.js";

export interface IPromptAggregateRepository {
  nextPromptId(): Promise<string>;
  nextVersionId(): Promise<string>;
  findById(id: string): Promise<Prompt | null>;
  save(prompt: Prompt): Promise<void>;
}
