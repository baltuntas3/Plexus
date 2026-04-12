import type { IPromptRepository } from "../../../domain/repositories/prompt-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { PromptVersion } from "../../../domain/entities/prompt-version.js";
import { NotFoundError } from "../../../domain/errors/domain-error.js";
import type { BraidGraph } from "../../../domain/value-objects/braid-graph.js";
import type { TokenCost } from "../../../domain/value-objects/token-cost.js";
import type { GraphQualityScore } from "../../../domain/value-objects/graph-quality-score.js";
import type { BraidGenerator } from "../../services/braid/braid-generator.js";
import type { GraphLinter } from "../../services/braid/lint/graph-linter.js";
import type { TokenUsage } from "../../services/ai-provider.js";
import type { GenerateBraidInputDto } from "../../dto/braid-dto.js";
import { ensurePromptAccess } from "./ensure-prompt-access.js";

export interface GenerateBraidCommand extends GenerateBraidInputDto {
  promptId: string;
  version: string;
  ownerId: string;
}

export interface GenerateBraidResult {
  version: PromptVersion;
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
  ) {}

  async execute(command: GenerateBraidCommand): Promise<GenerateBraidResult> {
    const prompt = await ensurePromptAccess(this.prompts, command.promptId, command.ownerId);
    const version = await this.versions.findByPromptAndVersion(
      command.promptId,
      command.version,
    );
    if (!version) {
      throw NotFoundError("Version not found");
    }

    const result = await this.generator.generate({
      classicalPrompt: version.classicalPrompt,
      taskType: prompt.taskType,
      generatorModel: command.generatorModel,
      forceRegenerate: command.forceRegenerate,
    });

    await this.versions.setBraidGraph(
      version.id,
      result.graph.mermaidCode,
      result.generatorModel,
    );

    const updated = await this.versions.findById(version.id);
    if (!updated) {
      throw NotFoundError("Version vanished after braid update");
    }

    const qualityScore = this.linter.lint(result.graph);

    return {
      version: updated,
      graph: result.graph,
      cost: result.cost,
      usage: result.usage,
      cached: result.cached,
      qualityScore,
    };
  }
}
