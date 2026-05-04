import { PromptVersion } from "../../../domain/entities/prompt-version.js";
import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import type { IUnitOfWork } from "../../../domain/services/unit-of-work.js";
import { PromptVersionNotFoundError } from "../../../domain/errors/domain-error.js";
import { PromptVariable } from "../../../domain/value-objects/prompt-variable.js";
import type { CreateVersionInputDto } from "../../dto/prompt-dto.js";
import type { PromptVersionSummary } from "../../queries/prompt-query-service.js";
import { versionToSummary } from "../../queries/prompt-projections.js";
import { assertVariableIntegrity } from "../../services/prompts/variable-integrity.js";
import { loadPromptInOrganization } from "./load-owned-prompt.js";

interface CreateVersionCommand extends CreateVersionInputDto {
  promptId: string;
  organizationId: string;
}

export class CreateVersionUseCase {
  constructor(
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
    private readonly idGenerator: IIdGenerator,
    private readonly uow: IUnitOfWork,
  ) {}

  async execute(command: CreateVersionCommand): Promise<PromptVersionSummary> {
    return this.uow.run(async () => {
      const prompt = await loadPromptInOrganization(
        this.prompts,
        command.promptId,
        command.organizationId,
      );

      // Fork source resolution happens here rather than on the aggregate:
      // PromptVersion is now its own aggregate so the "does this parent
      // belong to the prompt?" check is a repo lookup gated by promptId
      // equality, not an in-memory list scan.
      let parentVersionId: string | null = null;
      let inheritedVariables: readonly PromptVariable[] = [];
      if (command.fromVersion) {
        const source = await this.versions.findByPromptAndLabelInOrganization(
          prompt.id,
          command.fromVersion,
          command.organizationId,
        );
        if (!source) {
          throw PromptVersionNotFoundError(command.fromVersion);
        }
        parentVersionId = source.id;
        inheritedVariables = source.variables;
      }

      // Variables: explicit list overrides parent inheritance; otherwise
      // we carry the parent's set forward so callers don't need to repeat
      // unchanged definitions on every fork.
      const variables = command.variables
        ? command.variables.map((v) => PromptVariable.create(v))
        : inheritedVariables;
      assertVariableIntegrity({ body: command.sourcePrompt, variables });

      const label = prompt.allocateNextVersionLabel();
      const version = PromptVersion.create({
        id: this.idGenerator.newId(),
        promptId: prompt.id,
        organizationId: prompt.organizationId,
        version: label,
        sourcePrompt: command.sourcePrompt,
        name: command.name ?? null,
        parentVersionId,
        variables,
      });

      await this.versions.save(version);
      await this.prompts.save(prompt);

      return versionToSummary(version);
    });
  }
}
