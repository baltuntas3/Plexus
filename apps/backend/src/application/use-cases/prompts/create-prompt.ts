import { Prompt } from "../../../domain/entities/prompt.js";
import type { IPromptAggregateRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
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

export class CreatePromptUseCase {
  constructor(
    private readonly prompts: IPromptAggregateRepository,
    private readonly idGenerator: IIdGenerator,
  ) {}

  async execute(command: CreatePromptCommand): Promise<CreatePromptResult> {
    const prompt = Prompt.create({
      promptId: this.idGenerator.newId(),
      initialVersionId: this.idGenerator.newId(),
      ownerId: command.ownerId,
      name: command.name,
      description: command.description,
      taskType: command.taskType,
      initialPrompt: command.initialPrompt,
    });
    await this.prompts.save(prompt);
    const version = prompt.getVersionOrThrow("v1");
    return {
      prompt: promptToSummary(prompt),
      version: versionToSummary(version),
    };
  }
}
