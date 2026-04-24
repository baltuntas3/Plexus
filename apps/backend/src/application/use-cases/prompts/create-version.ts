import type { IPromptAggregateRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import type { CreateVersionInputDto } from "../../dto/prompt-dto.js";
import type { PromptVersionSummary } from "../../queries/prompt-query-service.js";
import { versionToSummary } from "../../queries/prompt-projections.js";
import { loadOwnedPrompt } from "./load-owned-prompt.js";

export interface CreateVersionCommand extends CreateVersionInputDto {
  promptId: string;
  ownerId: string;
}

export class CreateVersionUseCase {
  constructor(
    private readonly prompts: IPromptAggregateRepository,
    private readonly idGenerator: IIdGenerator,
  ) {}

  async execute(command: CreateVersionCommand): Promise<PromptVersionSummary> {
    const prompt = await loadOwnedPrompt(this.prompts, command.promptId, command.ownerId);
    const fromVersionId = command.fromVersion
      ? prompt.getVersionByLabelOrThrow(command.fromVersion).id
      : null;
    const version = prompt.createVersion({
      id: this.idGenerator.newId(),
      sourcePrompt: command.sourcePrompt,
      name: command.name,
      fromVersionId,
    });
    await this.prompts.save(prompt);
    return versionToSummary(version);
  }
}
