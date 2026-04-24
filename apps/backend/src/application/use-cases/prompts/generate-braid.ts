import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import { PromptVersion } from "../../../domain/entities/prompt-version.js";
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
import { loadOwnedPromptAndVersion } from "./load-owned-prompt.js";

export interface GenerateBraidCommand extends GenerateBraidInputDto {
  promptId: string;
  version: string;
  ownerId: string;
}

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
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
    private readonly generator: BraidGenerator,
    private readonly linter: GraphLinter,
    private readonly idGenerator: IIdGenerator,
  ) {}

  async execute(command: GenerateBraidCommand): Promise<GenerateBraidResult> {
    const { prompt, version: source } = await loadOwnedPromptAndVersion(
      this.prompts,
      this.versions,
      command.promptId,
      command.version,
      command.ownerId,
    );

    const result = await this.generator.generate({
      sourcePrompt: source.sourcePrompt,
      taskType: prompt.taskType,
      generatorModel: command.generatorModel,
      forceRegenerate: command.forceRegenerate,
    });

    const qualityScore = this.linter.lint(result.graph);

    const label = prompt.allocateNextVersionLabel();
    const forked = PromptVersion.fork({
      source,
      newId: this.idGenerator.newId(),
      newLabel: label,
      initialBraid: {
        graph: result.graph,
        authorship: BraidAuthorship.byModel(result.generatorModel),
      },
    });

    await this.versions.save(forked);
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
