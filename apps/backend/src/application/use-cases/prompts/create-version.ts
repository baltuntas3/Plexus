import type { IPromptRepository } from "../../../domain/repositories/prompt-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { PromptVersion } from "../../../domain/entities/prompt-version.js";
import type { CreateVersionInputDto } from "../../dto/prompt-dto.js";
import { ensurePromptAccess } from "./ensure-prompt-access.js";

export interface CreateVersionCommand extends CreateVersionInputDto {
  promptId: string;
  ownerId: string;
}

export class CreateVersionUseCase {
  constructor(
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
  ) {}

  async execute(command: CreateVersionCommand): Promise<PromptVersion> {
    await ensurePromptAccess(this.prompts, command.promptId, command.ownerId);
    const count = await this.versions.countByPrompt(command.promptId);
    const nextVersion = `v${count + 1}`;
    return this.versions.create({
      promptId: command.promptId,
      version: nextVersion,
      classicalPrompt: command.classicalPrompt,
      name: command.name?.trim() ? command.name.trim() : null,
    });
  }
}
