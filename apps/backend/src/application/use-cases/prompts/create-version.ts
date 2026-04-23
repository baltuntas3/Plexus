import type { IPromptAggregateRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { PromptVersion } from "../../../domain/entities/prompt-version.js";
import type { CreateVersionInputDto } from "../../dto/prompt-dto.js";
import { loadOwnedPrompt } from "./load-owned-prompt.js";

export interface CreateVersionCommand extends CreateVersionInputDto {
  promptId: string;
  ownerId: string;
}

export class CreateVersionUseCase {
  constructor(private readonly prompts: IPromptAggregateRepository) {}

  async execute(command: CreateVersionCommand): Promise<PromptVersion> {
    const prompt = await loadOwnedPrompt(this.prompts, command.promptId, command.ownerId);
    const version = prompt.createVersion({
      id: await this.prompts.nextVersionId(),
      sourcePrompt: command.sourcePrompt,
      name: command.name,
    });
    await this.prompts.save(prompt);
    return version;
  }
}
