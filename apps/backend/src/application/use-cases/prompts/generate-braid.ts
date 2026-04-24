import type { IPromptAggregateRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import { BraidAuthorship } from "../../../domain/value-objects/braid-authorship.js";
import type { BraidGraph } from "../../../domain/value-objects/braid-graph.js";
import type { TokenCost } from "../../../domain/value-objects/token-cost.js";
import type { GraphQualityScore } from "../../../domain/value-objects/graph-quality-score.js";
import type { BraidGenerator } from "../../services/braid/braid-generator.js";
import type { GraphLinter } from "../../services/braid/lint/graph-linter.js";
import type { TokenUsage } from "../../services/ai-provider.js";
import type { GenerateBraidInputDto } from "../../dto/braid-dto.js";
import type { PromptVersionSummary } from "../../queries/prompt-query-service.js";
import { versionToSummary } from "../../queries/prompt-projections.js";
import { loadOwnedPrompt } from "./load-owned-prompt.js";

export interface GenerateBraidCommand extends GenerateBraidInputDto {
  promptId: string;
  version: string;
  ownerId: string;
}

// Generation always forks — PromptVersion content is immutable, so each
// regenerate produces a brand-new version linked via parentVersionId to
// the source. The returned `version` is always a freshly created record.
export interface GenerateBraidResult {
  version: PromptVersionSummary;
  graph: BraidGraph;
  cost: TokenCost;
  usage: TokenUsage;
  cached: boolean;
  qualityScore: GraphQualityScore;
}

export class GenerateBraidUseCase {
  constructor(
    private readonly prompts: IPromptAggregateRepository,
    private readonly generator: BraidGenerator,
    private readonly linter: GraphLinter,
    private readonly idGenerator: IIdGenerator,
  ) {}

  async execute(command: GenerateBraidCommand): Promise<GenerateBraidResult> {
    const prompt = await loadOwnedPrompt(this.prompts, command.promptId, command.ownerId);
    const version = prompt.getVersionByLabelOrThrow(command.version);

    const result = await this.generator.generate({
      sourcePrompt: version.sourcePrompt,
      taskType: prompt.taskType,
      generatorModel: command.generatorModel,
      forceRegenerate: command.forceRegenerate,
    });

    const qualityScore = this.linter.lint(result.graph);
    const forked = prompt.upsertBraid({
      sourceVersionId: version.id,
      graph: result.graph,
      authorship: BraidAuthorship.byModel(result.generatorModel),
      forkVersionId: this.idGenerator.newId(),
    });
    await this.prompts.save(prompt);

    return {
      version: versionToSummary(forked),
      graph: result.graph,
      cost: result.cost,
      usage: result.usage,
      cached: result.cached,
      qualityScore,
    };
  }
}
