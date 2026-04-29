import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { UpdateVersionInputDto } from "../../dto/prompt-dto.js";
import type { PromptVersionSummary } from "../../queries/prompt-query-service.js";
import { versionToSummary } from "../../queries/prompt-projections.js";
import { loadPromptAndVersionInOrganization } from "./load-owned-prompt.js";

export interface UpdateVersionNameCommand extends UpdateVersionInputDto {
  promptId: string;
  version: string;
  organizationId: string;
  userId: string;
}

// Pure metadata mutation: the version aggregate renames itself, the Prompt
// root is loaded solely for the ownership gate and is not re-saved.
export class UpdateVersionNameUseCase {
  constructor(
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
  ) {}

  async execute(command: UpdateVersionNameCommand): Promise<PromptVersionSummary> {
    const { version } = await loadPromptAndVersionInOrganization(
      this.prompts,
      this.versions,
      command.promptId,
      command.version,
      command.organizationId,
    );
    version.rename(command.name);
    await this.versions.save(version);
    return versionToSummary(version);
  }
}
