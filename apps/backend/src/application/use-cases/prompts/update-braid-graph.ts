import type { IPromptRepository } from "../../../domain/repositories/prompt-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import { NotFoundError } from "../../../domain/errors/domain-error.js";
import { BraidGraph } from "../../../domain/value-objects/braid-graph.js";
import type { GraphQualityScore } from "../../../domain/value-objects/graph-quality-score.js";
import type { GraphLinter } from "../../services/braid/lint/graph-linter.js";
import { ensurePromptAccess } from "./ensure-prompt-access.js";

export interface UpdateBraidGraphCommand {
  promptId: string;
  version: string;
  ownerId: string;
  mermaidCode: string;
}

export interface UpdateBraidGraphResult {
  qualityScore: GraphQualityScore;
}

export class UpdateBraidGraphUseCase {
  constructor(
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
    private readonly linter: GraphLinter,
  ) {}

  async execute(command: UpdateBraidGraphCommand): Promise<UpdateBraidGraphResult> {
    await ensurePromptAccess(this.prompts, command.promptId, command.ownerId);

    const version = await this.versions.findByPromptAndVersion(
      command.promptId,
      command.version,
    );
    if (!version) {
      throw NotFoundError("Version not found");
    }

    // Validate: parse throws ValidationError on invalid Mermaid
    const graph = BraidGraph.parse(command.mermaidCode);

    // Preserve existing generatorModel; only the graph content changes
    await this.versions.updateBraidGraph(version.id, graph.mermaidCode);

    const qualityScore = this.linter.lint(graph);
    return { qualityScore };
  }
}
