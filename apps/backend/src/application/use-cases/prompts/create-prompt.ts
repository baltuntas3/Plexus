import type { IPromptRepository } from "../../../domain/repositories/prompt-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { Prompt } from "../../../domain/entities/prompt.js";
import type { PromptVersion } from "../../../domain/entities/prompt-version.js";
import type { CreatePromptInputDto } from "../../dto/prompt-dto.js";

export interface CreatePromptCommand extends CreatePromptInputDto {
  ownerId: string;
}

export interface CreatePromptResult {
  prompt: Prompt;
  version: PromptVersion;
}

export class CreatePromptUseCase {
  constructor(
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
  ) {}

  async execute(command: CreatePromptCommand): Promise<CreatePromptResult> {
    const prompt = await this.prompts.create({
      name: command.name,
      description: command.description,
      taskType: command.taskType,
      ownerId: command.ownerId,
    });

    const version = await this.versions.create({
      promptId: prompt.id,
      version: "v1",
      classicalPrompt: command.initialPrompt,
    });

    return { prompt, version };
  }
}
