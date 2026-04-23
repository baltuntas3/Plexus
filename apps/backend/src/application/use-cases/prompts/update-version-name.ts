import type { IPromptAggregateRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { PromptVersion } from "../../../domain/entities/prompt-version.js";
import type { UpdateVersionInputDto } from "../../dto/prompt-dto.js";
import { loadOwnedPrompt } from "./load-owned-prompt.js";

export interface UpdateVersionNameCommand extends UpdateVersionInputDto {
  promptId: string;
  version: string;
  ownerId: string;
}

export class UpdateVersionNameUseCase {
  constructor(private readonly prompts: IPromptAggregateRepository) {}

  async execute(command: UpdateVersionNameCommand): Promise<PromptVersion> {
    const prompt = await loadOwnedPrompt(this.prompts, command.promptId, command.ownerId);
    const updated = prompt.renameVersion(command.version, command.name);
    await this.prompts.save(prompt);
    return updated;
  }
}
