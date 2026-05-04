import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import type { IUnitOfWork } from "../../../domain/services/unit-of-work.js";
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
import { assertVariableIntegrity } from "../../services/prompts/variable-integrity.js";
import { loadPromptAndVersionInOrganization } from "./load-owned-prompt.js";

interface GenerateBraidCommand extends GenerateBraidInputDto {
  promptId: string;
  version: string;
  organizationId: string;
}

interface GenerateBraidResult {
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
    private readonly uow: IUnitOfWork,
  ) {}

  async execute(command: GenerateBraidCommand): Promise<GenerateBraidResult> {
    // The LLM call sits outside the UoW on purpose: external I/O does not
    // belong inside a Mongo transaction (both for latency and for the risk
    // of `withTransaction` retrying a non-idempotent side effect). The
    // transactional boundary covers only the persistence step where the
    // counter advance + forked version save must land atomically.
    const { prompt, source, result, qualityScore } = await this.loadAndGenerate(command);

    // Generator may invent or drop `{{var}}` placeholders despite the
    // instruction to preserve them; reject the result rather than silently
    // creating a version with broken substitution.
    assertVariableIntegrity({
      body: source.sourcePrompt,
      mermaid: result.graph.mermaidCode,
      variables: source.variables,
    });

    return this.uow.run(async () => {
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
    });
  }

  private async loadAndGenerate(command: GenerateBraidCommand) {
    const { prompt, version: source } = await loadPromptAndVersionInOrganization(
      this.prompts,
      this.versions,
      command.promptId,
      command.version,
      command.organizationId,
    );
    const result = await this.generator.generate({
      sourcePrompt: source.sourcePrompt,
      taskType: prompt.taskType,
      generatorModel: command.generatorModel,
      forceRegenerate: command.forceRegenerate,
    });
    const qualityScore = this.linter.lint(result.graph);
    return { prompt, source, result, qualityScore };
  }
}
