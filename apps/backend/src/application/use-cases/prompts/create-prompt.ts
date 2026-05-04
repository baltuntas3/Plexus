import { Prompt } from "../../../domain/entities/prompt.js";
import { PromptVersion } from "../../../domain/entities/prompt-version.js";
import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import type { IUnitOfWork } from "../../../domain/services/unit-of-work.js";
import { PromptVariable } from "../../../domain/value-objects/prompt-variable.js";
import type { CreatePromptInputDto } from "../../dto/prompt-dto.js";
import type {
  PromptSummary,
  PromptVersionSummary,
} from "../../queries/prompt-query-service.js";
import {
  promptToSummary,
  versionToSummary,
} from "../../queries/prompt-projections.js";
import { assertVariableIntegrity } from "../../services/prompts/variable-integrity.js";

interface CreatePromptCommand extends CreatePromptInputDto {
  organizationId: string;
  userId: string;
}

interface CreatePromptResult {
  prompt: PromptSummary;
  version: PromptVersionSummary;
}

// Creates a Prompt root and its initial PromptVersion. Both writes live
// inside a single UoW: either the root (with versionCounter=1) and the
// matching initial version land together, or nothing lands — a partially
// created prompt can no longer strand `versionCounter=1` with no version.
export class CreatePromptUseCase {
  constructor(
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
    private readonly idGenerator: IIdGenerator,
    private readonly uow: IUnitOfWork,
  ) {}

  async execute(command: CreatePromptCommand): Promise<CreatePromptResult> {
    const variables = (command.variables ?? []).map((v) =>
      PromptVariable.create(v),
    );
    assertVariableIntegrity({ body: command.initialPrompt, variables });

    return this.uow.run(async () => {
      const prompt = Prompt.create({
        promptId: this.idGenerator.newId(),
        organizationId: command.organizationId,
        creatorId: command.userId,
        name: command.name,
        description: command.description,
        taskType: command.taskType,
      });
      const label = prompt.allocateNextVersionLabel();
      const version = PromptVersion.create({
        id: this.idGenerator.newId(),
        promptId: prompt.id,
        organizationId: prompt.organizationId,
        version: label,
        sourcePrompt: command.initialPrompt,
        parentVersionId: null,
        variables,
      });

      await this.prompts.save(prompt);
      await this.versions.save(version);

      return {
        prompt: promptToSummary(prompt),
        version: versionToSummary(version),
      };
    });
  }
}
