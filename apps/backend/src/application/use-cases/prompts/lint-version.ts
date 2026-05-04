import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import { PromptVersionHasNoBraidError } from "../../../domain/errors/domain-error.js";
import type { GraphQualityScore } from "../../../domain/value-objects/graph-quality-score.js";
import type { GraphLinter } from "../../services/braid/lint/graph-linter.js";
import { loadPromptAndVersionInOrganization } from "./load-owned-prompt.js";

interface LintVersionCommand {
  promptId: string;
  version: string;
  organizationId: string;
}

export class LintVersionUseCase {
  constructor(
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
    private readonly linter: GraphLinter,
  ) {}

  async execute(command: LintVersionCommand): Promise<GraphQualityScore> {
    const { version } = await loadPromptAndVersionInOrganization(
      this.prompts,
      this.versions,
      command.promptId,
      command.version,
      command.organizationId,
    );
    if (!version.braidGraph) {
      throw PromptVersionHasNoBraidError();
    }
    return this.linter.lint(version.braidGraph);
  }
}
