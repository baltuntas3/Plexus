import type { IPromptRepository } from "../../../domain/repositories/prompt-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { PromptVersion } from "../../../domain/entities/prompt-version.js";
import { NotFoundError } from "../../../domain/errors/domain-error.js";
import type { UpdateVersionInputDto } from "../../dto/prompt-dto.js";
import { ensurePromptAccess } from "./ensure-prompt-access.js";

export interface UpdateVersionNameCommand extends UpdateVersionInputDto {
  promptId: string;
  version: string;
  ownerId: string;
}

export class UpdateVersionNameUseCase {
  constructor(
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
  ) {}

  async execute(command: UpdateVersionNameCommand): Promise<PromptVersion> {
    await ensurePromptAccess(this.prompts, command.promptId, command.ownerId);
    const target = await this.versions.findByPromptAndVersion(command.promptId, command.version);
    if (!target) {
      throw NotFoundError("Version not found");
    }
    await this.versions.updateName(target.id, command.name);
    const updated = await this.versions.findById(target.id);
    if (!updated) {
      throw NotFoundError("Version vanished after update");
    }
    return updated;
  }
}
