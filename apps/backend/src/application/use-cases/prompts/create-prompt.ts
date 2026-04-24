import { Prompt } from "../../../domain/entities/prompt.js";
import { PromptVersion } from "../../../domain/entities/prompt-version.js";
import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import type { CreatePromptInputDto } from "../../dto/prompt-dto.js";
import type {
  PromptSummary,
  PromptVersionSummary,
} from "../../queries/prompt-query-service.js";
import {
  promptToSummary,
  versionToSummary,
} from "../../queries/prompt-projections.js";

export interface CreatePromptCommand extends CreatePromptInputDto {
  ownerId: string;
}

export interface CreatePromptResult {
  prompt: PromptSummary;
  version: PromptVersionSummary;
}

// Creates a Prompt root and its initial PromptVersion. Two writes because
// the two are separate aggregates; ordering is root-first so that on
// partial failure the dangling prompt is visible (and repairable) rather
// than a dangling version with no prompt. The root's versionCounter is
// advanced by `allocateNextVersionLabel()` before the save so hydrate
// reads see counter=1.
export class CreatePromptUseCase {
  constructor(
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
    private readonly idGenerator: IIdGenerator,
  ) {}

  async execute(command: CreatePromptCommand): Promise<CreatePromptResult> {
    const prompt = Prompt.create({
      promptId: this.idGenerator.newId(),
      ownerId: command.ownerId,
      name: command.name,
      description: command.description,
      taskType: command.taskType,
    });
    const label = prompt.allocateNextVersionLabel();
    const version = PromptVersion.create({
      id: this.idGenerator.newId(),
      promptId: prompt.id,
      version: label,
      sourcePrompt: command.initialPrompt,
      parentVersionId: null,
    });

    await this.prompts.save(prompt);
    await this.versions.save(version);

    return {
      prompt: promptToSummary(prompt),
      version: versionToSummary(version),
    };
  }
}
