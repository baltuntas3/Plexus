import { PromptVersion } from "../../../domain/entities/prompt-version.js";
import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import { PromptVersionNotFoundError } from "../../../domain/errors/domain-error.js";
import type { CreateVersionInputDto } from "../../dto/prompt-dto.js";
import type { PromptVersionSummary } from "../../queries/prompt-query-service.js";
import { versionToSummary } from "../../queries/prompt-projections.js";
import { loadOwnedPrompt } from "./load-owned-prompt.js";

export interface CreateVersionCommand extends CreateVersionInputDto {
  promptId: string;
  ownerId: string;
}

export class CreateVersionUseCase {
  constructor(
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
    private readonly idGenerator: IIdGenerator,
  ) {}

  async execute(command: CreateVersionCommand): Promise<PromptVersionSummary> {
    const prompt = await loadOwnedPrompt(this.prompts, command.promptId, command.ownerId);

    // Fork source resolution happens here rather than on the aggregate:
    // PromptVersion is now its own aggregate so the "does this parent
    // belong to the prompt?" check is a repo lookup gated by promptId
    // equality, not an in-memory list scan.
    let parentVersionId: string | null = null;
    if (command.fromVersion) {
      const source = await this.versions.findByPromptAndLabel(
        prompt.id,
        command.fromVersion,
      );
      if (!source) {
        throw PromptVersionNotFoundError(command.fromVersion);
      }
      parentVersionId = source.id;
    }

    const label = prompt.allocateNextVersionLabel();
    const version = PromptVersion.create({
      id: this.idGenerator.newId(),
      promptId: prompt.id,
      version: label,
      sourcePrompt: command.sourcePrompt,
      name: command.name ?? null,
      parentVersionId,
    });

    await this.versions.save(version);
    await this.prompts.save(prompt);

    return versionToSummary(version);
  }
}
