import type { IPromptAggregateRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import { BraidAuthorship } from "../../../domain/value-objects/braid-authorship.js";
import { BraidGraph } from "../../../domain/value-objects/braid-graph.js";
import type { GraphQualityScore } from "../../../domain/value-objects/graph-quality-score.js";
import { ValidationError } from "../../../domain/errors/domain-error.js";
import type { GraphLinter } from "../../services/braid/lint/graph-linter.js";
import { loadOwnedPrompt } from "./load-owned-prompt.js";

export interface UpdateBraidGraphCommand {
  promptId: string;
  version: string;
  ownerId: string;
  mermaidCode: string;
}

export interface UpdateBraidGraphResult {
  // New version label the fork was written to. Clients redirect to this
  // label after a save — the source version is frozen.
  newVersion: string;
  qualityScore: GraphQualityScore;
}

// Manual mermaid-edit flow. Because PromptVersion content is immutable, the
// user's edit becomes a new forked version rather than rewriting the source
// in place. The parent's generator model is carried over — the edit derives
// from that model's output, even when the user hand-corrects a line.
export class UpdateBraidGraphUseCase {
  constructor(
    private readonly prompts: IPromptAggregateRepository,
    private readonly linter: GraphLinter,
    private readonly idGenerator: IIdGenerator,
  ) {}

  async execute(command: UpdateBraidGraphCommand): Promise<UpdateBraidGraphResult> {
    const prompt = await loadOwnedPrompt(this.prompts, command.promptId, command.ownerId);
    const source = prompt.getVersionByLabelOrThrow(command.version);
    if (!source.hasBraidRepresentation) {
      // Editing mermaid assumes there was a braid to start from. Callers
      // that want to attach a braid to a classical version must go through
      // the generate/chat flows — those know which model the braid came from.
      throw ValidationError(
        "Cannot edit mermaid on a version that has no BRAID graph yet",
      );
    }
    const graph = BraidGraph.parse(command.mermaidCode);
    // Manual edit: no LLM ran. Record the honest provenance — "manual,
    // derived from <whichever model produced the parent's content>" —
    // instead of inheriting the parent's generatorModel as if this text
    // were its output.
    const forked = prompt.upsertBraid({
      sourceVersionId: source.id,
      graph,
      authorship: BraidAuthorship.manual(source.generatorModel),
      forkVersionId: this.idGenerator.newId(),
    });
    await this.prompts.save(prompt);
    return { newVersion: forked.version, qualityScore: this.linter.lint(graph) };
  }
}
