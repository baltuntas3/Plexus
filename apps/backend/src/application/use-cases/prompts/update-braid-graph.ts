import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import { PromptVersion } from "../../../domain/entities/prompt-version.js";
import { BraidAuthorship } from "../../../domain/value-objects/braid-authorship.js";
import { BraidGraph } from "../../../domain/value-objects/braid-graph.js";
import type { GraphQualityScore } from "../../../domain/value-objects/graph-quality-score.js";
import { ValidationError } from "../../../domain/errors/domain-error.js";
import type { GraphLinter } from "../../services/braid/lint/graph-linter.js";
import { loadOwnedPromptAndVersion } from "./load-owned-prompt.js";

export interface UpdateBraidGraphCommand {
  promptId: string;
  version: string;
  ownerId: string;
  mermaidCode: string;
}

export interface UpdateBraidGraphResult {
  newVersion: string;
  qualityScore: GraphQualityScore;
}

// Manual mermaid edit: fork the source version carrying the user's graph.
// Authorship is recorded as manual so the fork does not falsely claim the
// parent's model produced this text.
export class UpdateBraidGraphUseCase {
  constructor(
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
    private readonly linter: GraphLinter,
    private readonly idGenerator: IIdGenerator,
  ) {}

  async execute(command: UpdateBraidGraphCommand): Promise<UpdateBraidGraphResult> {
    const { prompt, version: source } = await loadOwnedPromptAndVersion(
      this.prompts,
      this.versions,
      command.promptId,
      command.version,
      command.ownerId,
    );
    if (!source.hasBraidRepresentation) {
      throw ValidationError(
        "Cannot edit mermaid on a version that has no BRAID graph yet",
      );
    }
    const graph = BraidGraph.parse(command.mermaidCode);

    const label = prompt.allocateNextVersionLabel();
    const forked = PromptVersion.fork({
      source,
      newId: this.idGenerator.newId(),
      newLabel: label,
      initialBraid: {
        graph,
        authorship: BraidAuthorship.manual(source.generatorModel),
      },
    });

    await this.versions.save(forked);
    await this.prompts.save(prompt);

    return { newVersion: forked.version, qualityScore: this.linter.lint(graph) };
  }
}
