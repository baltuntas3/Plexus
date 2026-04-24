import type { IPromptAggregateRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import type { PromptVersion } from "../../../domain/entities/prompt-version.js";
import type { BraidGraph } from "../../../domain/value-objects/braid-graph.js";
import type { TokenCost } from "../../../domain/value-objects/token-cost.js";
import type { GraphQualityScore } from "../../../domain/value-objects/graph-quality-score.js";
import type { BraidGenerator } from "../../services/braid/braid-generator.js";
import type { GraphLinter } from "../../services/braid/lint/graph-linter.js";
import type { TokenUsage } from "../../services/ai-provider.js";
import type { GenerateBraidInputDto } from "../../dto/braid-dto.js";
import { loadOwnedPrompt } from "./load-owned-prompt.js";

export interface GenerateBraidCommand extends GenerateBraidInputDto {
  promptId: string;
  version: string;
  ownerId: string;
}

export interface GenerateBraidResult {
  version: PromptVersion;
  // True when a new version was created to hold the BRAID; false when the
  // existing version already had a graph and was updated in place (forceRegenerate).
  createdNewVersion: boolean;
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
    const version = prompt.getVersionOrThrow(command.version);

    const result = await this.generator.generate({
      sourcePrompt: version.sourcePrompt,
      taskType: prompt.taskType,
      generatorModel: command.generatorModel,
      forceRegenerate: command.forceRegenerate,
    });

    const qualityScore = this.linter.lint(result.graph);
    // The aggregate decides whether to fork a new version or overwrite; the
    // fork id is pre-allocated here so the aggregate stays free of the
    // IIdGenerator port. It is unused on the overwrite branch — an acceptable
    // trade since ObjectId allocation is effectively free.
    const { version: updatedVersion, createdNewVersion } = prompt.attachGeneratedBraid({
      sourceVersion: command.version,
      graph: result.graph,
      generatorModel: result.generatorModel,
      forkVersionId: this.idGenerator.newId(),
    });
    await this.prompts.save(prompt);

    return {
      version: updatedVersion,
      createdNewVersion,
      graph: result.graph,
      cost: result.cost,
      usage: result.usage,
      cached: result.cached,
      qualityScore,
    };
  }
}
