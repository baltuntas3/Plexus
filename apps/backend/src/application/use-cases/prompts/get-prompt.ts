import type { IPromptAggregateRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { Prompt } from "../../../domain/entities/prompt.js";
import { loadOwnedPrompt } from "./load-owned-prompt.js";

export class GetPromptUseCase {
  constructor(private readonly prompts: IPromptAggregateRepository) {}

  async execute(promptId: string, ownerId: string): Promise<Prompt> {
    return loadOwnedPrompt(this.prompts, promptId, ownerId);
  }
}
