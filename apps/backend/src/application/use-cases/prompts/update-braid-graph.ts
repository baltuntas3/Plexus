import type { IPromptAggregateRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import { BraidGraph } from "../../../domain/value-objects/braid-graph.js";
import type { GraphQualityScore } from "../../../domain/value-objects/graph-quality-score.js";
import type { GraphLinter } from "../../services/braid/lint/graph-linter.js";
import { loadOwnedPrompt } from "./load-owned-prompt.js";

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
    private readonly prompts: IPromptAggregateRepository,
    private readonly linter: GraphLinter,
  ) {}

  async execute(command: UpdateBraidGraphCommand): Promise<UpdateBraidGraphResult> {
    const prompt = await loadOwnedPrompt(this.prompts, command.promptId, command.ownerId);
    const graph = BraidGraph.parse(command.mermaidCode);
    prompt.updateBraidGraph(command.version, graph);
    await this.prompts.save(prompt);
    return { qualityScore: this.linter.lint(graph) };
  }
}
