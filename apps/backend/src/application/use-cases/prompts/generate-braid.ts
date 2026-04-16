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

    const qualityScore = this.linter.lint(result.graph);

    // If the version already has a BRAID (forceRegenerate path), update in place.
    // Otherwise create a new version so classical and BRAID are separate entries.
    if (version.braidGraph) {
      await this.versions.setBraidGraph(version.id, result.graph.mermaidCode, result.generatorModel);
      const updated = await this.versions.findById(version.id);
      if (!updated) throw NotFoundError("Version vanished after braid update");
      return { version: updated, createdNewVersion: false, graph: result.graph, cost: result.cost, usage: result.usage, cached: result.cached, qualityScore };
    }

    const count = await this.versions.countByPrompt(command.promptId);
    const newVersionName = `v${count + 1}`;
    const newVersion = await this.versions.create({
      promptId: command.promptId,
      version: newVersionName,
      classicalPrompt: version.classicalPrompt,
    });
    await this.versions.setBraidGraph(newVersion.id, result.graph.mermaidCode, result.generatorModel);

    return {
      version: newVersion,
      createdNewVersion: true,
      graph: result.graph,
      cost: result.cost,
      usage: result.usage,
      cached: result.cached,
      qualityScore,
    };
  }
}
