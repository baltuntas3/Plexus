import type { IPromptAggregateRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { PromptVersion } from "../../../domain/entities/prompt-version.js";
import { loadOwnedPrompt } from "./load-owned-prompt.js";

export interface GetVersionCommand {
  promptId: string;
  version: string;
  ownerId: string;
}

export class GetVersionUseCase {
  constructor(private readonly prompts: IPromptAggregateRepository) {}

  async execute(command: GetVersionCommand): Promise<PromptVersion> {
    const prompt = await loadOwnedPrompt(this.prompts, command.promptId, command.ownerId);
    return prompt.getVersionOrThrow(command.version);
  }
}
