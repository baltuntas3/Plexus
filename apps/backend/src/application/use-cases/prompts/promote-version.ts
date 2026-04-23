import type { IPromptAggregateRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { PromptVersion } from "../../../domain/entities/prompt-version.js";
import type { PromoteVersionInputDto } from "../../dto/prompt-dto.js";
import { loadOwnedPrompt } from "./load-owned-prompt.js";

export interface PromoteVersionCommand extends PromoteVersionInputDto {
  promptId: string;
  version: string;
  ownerId: string;
}

export class PromoteVersionUseCase {
  constructor(private readonly prompts: IPromptAggregateRepository) {}

  async execute(command: PromoteVersionCommand): Promise<PromptVersion> {
    const prompt = await loadOwnedPrompt(this.prompts, command.promptId, command.ownerId);
    const updated = prompt.promoteVersion(command.version, command.targetStatus);
    await this.prompts.save(prompt);
    return updated;
  }
}
