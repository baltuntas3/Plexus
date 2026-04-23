import type { IPromptAggregateRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import { PromptVersionHasNoBraidError } from "../../../domain/errors/domain-error.js";
import type { GraphQualityScore } from "../../../domain/value-objects/graph-quality-score.js";
import type { GraphLinter } from "../../services/braid/lint/graph-linter.js";
import { loadOwnedPrompt } from "./load-owned-prompt.js";

export interface LintVersionCommand {
  promptId: string;
  version: string;
  ownerId: string;
}

export class LintVersionUseCase {
  constructor(
    private readonly prompts: IPromptAggregateRepository,
    private readonly linter: GraphLinter,
  ) {}

  async execute(command: LintVersionCommand): Promise<GraphQualityScore> {
    const prompt = await loadOwnedPrompt(this.prompts, command.promptId, command.ownerId);
    const version = prompt.getVersionOrThrow(command.version);
    if (!version.braidGraph) {
      throw PromptVersionHasNoBraidError();
    }
    return this.linter.lint(version.braidGraph);
  }
}
