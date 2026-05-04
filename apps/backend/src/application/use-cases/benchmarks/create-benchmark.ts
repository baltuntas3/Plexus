import { Benchmark } from "../../../domain/entities/benchmark.js";
import type { TaskType } from "@plexus/shared-types";
import type { IBenchmarkRepository } from "../../../domain/repositories/benchmark-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import type {
  IPromptQueryService,
  PromptVersionSummary,
} from "../../queries/prompt-query-service.js";
import { NotFoundError, ValidationError } from "../../../domain/errors/domain-error.js";
import type { CreateBenchmarkDto } from "../../dto/benchmark-dto.js";
import {
  ModelRegistry,
  pickGeneratorModel,
  pickJudgeModels,
} from "../../services/model-registry.js";
import {
  TestCaseGenerator,
  buildEvaluationSpecFromVersions,
} from "../../services/benchmark/test-case-generator.js";
import {
  BenchmarkCostEstimator,
  DEFAULT_BUDGET_USD,
  STUB_AVG_INPUT_TOKENS,
  averageTokenCount,
} from "../../services/benchmark/benchmark-cost-estimator.js";
import type { IAIProviderFactory } from "../../services/ai-provider.js";
import { BenchmarkSeed } from "../../../domain/value-objects/benchmark-seed.js";

// Creates a benchmark in "draft" status. Test cases are generated up-front
// so the user can review and optionally annotate them with expected outputs
// before starting the run.
//
// The caller only chooses what to benchmark (versions, solver models) and
// how many cases to probe. Everything that makes a benchmark fair and
// reproducible — judge ensemble, generator model, test-generation mode,
// repetitions, seed, concurrency — is derived here so the surface area
// stays minimal but the defaults are explicit.

const DEFAULT_GENERATOR_MODEL = "openai/gpt-oss-120b";
const DEFAULT_JUDGE_COUNT = 2;
const DEFAULT_REPETITIONS = 3;
const DEFAULT_CONCURRENCY = 4;

export type CreateBenchmarkCommand = CreateBenchmarkDto & {
  organizationId: string;
  userId: string;
};

export interface CreateBenchmarkResult {
  benchmark: Benchmark;
  versionLabels: Record<string, string>;
}

export class CreateBenchmarkUseCase {
  private readonly costEstimator = new BenchmarkCostEstimator();

  constructor(
    private readonly benchmarks: IBenchmarkRepository,
    private readonly promptQueries: IPromptQueryService,
    private readonly providers: IAIProviderFactory,
    private readonly idGenerator: IIdGenerator,
  ) {}

  async execute(command: CreateBenchmarkCommand): Promise<CreateBenchmarkResult> {
    const resolvedVersions = await this.loadVersions(
      command.promptVersionIds,
      command.organizationId,
    );

    for (const model of command.solverModels) {
      ModelRegistry.require(model);
    }

    const judgeModels = pickJudgeModels(command.solverModels, DEFAULT_JUDGE_COUNT);
    const generatorModel = pickGeneratorModel(
      command.solverModels,
      DEFAULT_GENERATOR_MODEL,
    );
    const testGenerationMode =
      resolvedVersions.length > 1 ? "hybrid" : "shared-core";
    const seed = BenchmarkSeed.random().toNumber();
    const taskType = await this.resolveTaskType(
      resolvedVersions,
      command.organizationId,
    );

    const repetitions = command.repetitions ?? DEFAULT_REPETITIONS;
    const budgetUsd = command.budgetUsd ?? DEFAULT_BUDGET_USD;

    // Pre-flight gate: forecast the run cost using a stub for the
    // not-yet-generated user inputs, BEFORE we spend an LLM call on test
    // generation. Configs whose model/test-count/repetitions combination
    // alone blows the budget never reach the generator.
    const preFlightForecast = this.costEstimator.estimate({
      versions: resolvedVersions,
      testCount: command.testCount,
      avgInputTokens: STUB_AVG_INPUT_TOKENS,
      solverModels: command.solverModels,
      judgeModels,
      repetitions,
    });
    if (preFlightForecast.estimatedTotalCostUsd > budgetUsd) {
      throw ValidationError(
        `Estimated benchmark cost $${preFlightForecast.estimatedTotalCostUsd.toFixed(4)} exceeds the $${budgetUsd.toFixed(2)} cap. Reduce test count, solver count, or repetitions.`,
      );
    }

    const spec = buildEvaluationSpecFromVersions(
      resolvedVersions,
      testGenerationMode,
      seed,
      taskType,
    );
    const generator = new TestCaseGenerator(this.providers);
    const generated = await generator.generate(
      spec,
      command.testCount,
      generatorModel,
      seed,
    );

    // Post-generation forecast: recompute with the real input lengths so the
    // stored cost estimate reflects what the run will actually cost. Also
    // re-checks the budget gate in case the generator produced unusually
    // long inputs that the stub under-estimated.
    const costForecast = this.costEstimator.estimate({
      versions: resolvedVersions,
      testCount: generated.length,
      avgInputTokens: averageTokenCount(generated.map((tc) => tc.input)),
      solverModels: command.solverModels,
      judgeModels,
      repetitions,
    });
    if (costForecast.estimatedTotalCostUsd > budgetUsd) {
      throw ValidationError(
        `Estimated benchmark cost $${costForecast.estimatedTotalCostUsd.toFixed(4)} exceeds the $${budgetUsd.toFixed(2)} cap. Reduce test count, solver count, or repetitions.`,
      );
    }

    const benchmark = Benchmark.create({
      id: this.idGenerator.newId(),
      name: command.name,
      organizationId: command.organizationId,
      creatorId: command.userId,
      promptVersionIds: command.promptVersionIds,
      solverModels: command.solverModels,
      judgeModels,
      generatorModel,
      testGenerationMode,
      taskType,
      costForecast,
      repetitions,
      seed,
      concurrency: DEFAULT_CONCURRENCY,
      cellTimeoutMs: null,
      budgetUsd,
      testCases: generated.map((tc) => ({
        id: this.idGenerator.newId(),
        input: tc.input,
        expectedOutput: null,
        category: tc.category,
        source: "generated" as const,
      })),
    });
    await this.benchmarks.save(benchmark);

    const versionLabels: Record<string, string> = {};
    resolvedVersions.forEach((v, i) => {
      versionLabels[v.id] = v.name?.trim() || v.version || `v${i + 1}`;
    });
    return { benchmark, versionLabels };
  }

  private async resolveTaskType(
    versions: PromptVersionSummary[],
    organizationId: string,
  ): Promise<TaskType> {
    const promptIds = [...new Set(versions.map((version) => version.promptId))];
    const summaries = await this.promptQueries.findPromptSummariesByIdsInOrganization(
      promptIds,
      organizationId,
    );
    const missing = promptIds.filter((id) => !summaries.has(id));
    if (missing.length > 0) {
      throw NotFoundError(`Prompt(s) not found: ${missing.join(", ")}`);
    }
    const taskTypes = [...new Set([...summaries.values()].map((s) => s.taskType))];
    if (taskTypes.length > 1) {
      throw ValidationError(
        `Benchmark versions span multiple task types (${taskTypes.join(", ")}); compare prompts with the same task type`,
      );
    }
    return (taskTypes[0] ?? "general") as TaskType;
  }

  private async loadVersions(
    ids: string[],
    organizationId: string,
  ): Promise<PromptVersionSummary[]> {
    // Org-scoped lookup collapses "missing" and "in another org" into a
    // single 404-shaped response. A caller replaying foreign version ids
    // cannot tell whether the id exists under a different tenant.
    const resolved = await this.promptQueries.findVersionSummariesByIdsInOrganization(
      ids,
      organizationId,
    );
    for (const id of ids) {
      if (!resolved.has(id)) throw NotFoundError(`PromptVersion ${id} not found`);
    }
    return ids.map((id) => resolved.get(id) as PromptVersionSummary);
  }
}
