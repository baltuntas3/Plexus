import type { IPromptRepository } from "../../../domain/repositories/prompt-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import { NotFoundError, ValidationError } from "../../../domain/errors/domain-error.js";
import { BraidGraph } from "../../../domain/value-objects/braid-graph.js";
import type { GraphQualityScore } from "../../../domain/value-objects/graph-quality-score.js";
import type { GraphLinter } from "../../services/braid/lint/graph-linter.js";
import { ensurePromptAccess } from "./ensure-prompt-access.js";

export interface LintVersionCommand {
  promptId: string;
  version: string;
  ownerId: string;
}

export class LintVersionUseCase {
  constructor(
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
    private readonly linter: GraphLinter,
  ) {}

  async execute(command: LintVersionCommand): Promise<GraphQualityScore> {
    await ensurePromptAccess(this.prompts, command.promptId, command.ownerId);
    const version = await this.versions.findByPromptAndVersion(
      command.promptId,
      command.version,
    );
    if (!version) {
      throw NotFoundError("Version not found");
    }
    if (!version.braidGraph) {
      throw ValidationError("Version has no BRAID graph to lint. Generate one first.");
    }
    const graph = BraidGraph.parse(version.braidGraph);
    return this.linter.lint(graph);
  }
}
