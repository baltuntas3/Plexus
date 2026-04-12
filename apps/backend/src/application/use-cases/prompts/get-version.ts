import type { IPromptRepository } from "../../../domain/repositories/prompt-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { PromptVersion } from "../../../domain/entities/prompt-version.js";
import { NotFoundError } from "../../../domain/errors/domain-error.js";
import { ensurePromptAccess } from "./ensure-prompt-access.js";

export interface GetVersionCommand {
  promptId: string;
  version: string;
  ownerId: string;
}

export class GetVersionUseCase {
  constructor(
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
  ) {}

  async execute(command: GetVersionCommand): Promise<PromptVersion> {
    await ensurePromptAccess(this.prompts, command.promptId, command.ownerId);
    const version = await this.versions.findByPromptAndVersion(command.promptId, command.version);
    if (!version) {
      throw NotFoundError("Version not found");
    }
    return version;
  }
}
