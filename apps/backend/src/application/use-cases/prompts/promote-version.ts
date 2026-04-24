import type { IPromptAggregateRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { PromoteVersionInputDto } from "../../dto/prompt-dto.js";
import type { PromptVersionSummary } from "../../queries/prompt-query-service.js";
import { versionToSummary } from "../../queries/prompt-projections.js";
import { loadOwnedPrompt } from "./load-owned-prompt.js";

export interface PromoteVersionCommand extends PromoteVersionInputDto {
  promptId: string;
  version: string;
  ownerId: string;
}

export class PromoteVersionUseCase {
  constructor(private readonly prompts: IPromptAggregateRepository) {}

  async execute(command: PromoteVersionCommand): Promise<PromptVersionSummary> {
    const prompt = await loadOwnedPrompt(this.prompts, command.promptId, command.ownerId);
    const target = prompt.getVersionByLabelOrThrow(command.version);
    const updated = prompt.promoteVersion(target.id, command.targetStatus);
    await this.prompts.save(prompt);
    return versionToSummary(updated);
  }
}
