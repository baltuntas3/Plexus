import { Prompt } from "../../../domain/entities/prompt.js";
import type { PromptVersion } from "../../../domain/entities/prompt-version.js";
import type { IPromptAggregateRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { CreatePromptInputDto } from "../../dto/prompt-dto.js";

export interface CreatePromptCommand extends CreatePromptInputDto {
  ownerId: string;
}

export interface CreatePromptResult {
  prompt: Prompt;
  version: PromptVersion;
}

export class CreatePromptUseCase {
  constructor(private readonly prompts: IPromptAggregateRepository) {}

  async execute(command: CreatePromptCommand): Promise<CreatePromptResult> {
    const [promptId, versionId] = await Promise.all([
      this.prompts.nextPromptId(),
      this.prompts.nextVersionId(),
    ]);
    const prompt = Prompt.create({
      id: promptId,
      ownerId: command.ownerId,
      name: command.name,
      description: command.description,
      taskType: command.taskType,
      initialVersionId: versionId,
      initialPrompt: command.initialPrompt,
    });
    await this.prompts.save(prompt);
    const version = prompt.getVersionOrThrow("v1");
    return { prompt, version };
  }
}
