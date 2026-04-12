import type { IPromptRepository } from "../../../domain/repositories/prompt-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { PromptVersion } from "../../../domain/entities/prompt-version.js";
import { NotFoundError } from "../../../domain/errors/domain-error.js";
import type { PromoteVersionInputDto } from "../../dto/prompt-dto.js";
import { ensurePromptAccess } from "./ensure-prompt-access.js";

export interface PromoteVersionCommand extends PromoteVersionInputDto {
  promptId: string;
  version: string;
  ownerId: string;
}

export class PromoteVersionUseCase {
  constructor(
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
  ) {}

  async execute(command: PromoteVersionCommand): Promise<PromptVersion> {
    await ensurePromptAccess(this.prompts, command.promptId, command.ownerId);
    const target = await this.versions.findByPromptAndVersion(command.promptId, command.version);
    if (!target) {
      throw NotFoundError("Version not found");
    }

    if (command.targetStatus === "production") {
      const currentProd = await this.versions.findCurrentByStatus(command.promptId, "production");
      if (currentProd && currentProd.id !== target.id) {
        await this.versions.updateStatus(currentProd.id, "staging");
      }
      await this.prompts.setProductionVersion(command.promptId, target.version);
    }

    await this.versions.updateStatus(target.id, command.targetStatus);
    const updated = await this.versions.findById(target.id);
    if (!updated) {
      throw NotFoundError("Version vanished after update");
    }
    return updated;
  }
}
