import type { IPromptRepository } from "../../../domain/repositories/prompt-repository.js";
import type { Prompt } from "../../../domain/entities/prompt.js";
import { ensurePromptAccess } from "./ensure-prompt-access.js";

export class GetPromptUseCase {
  constructor(private readonly prompts: IPromptRepository) {}

  async execute(promptId: string, ownerId: string): Promise<Prompt> {
    return ensurePromptAccess(this.prompts, promptId, ownerId);
  }
}
