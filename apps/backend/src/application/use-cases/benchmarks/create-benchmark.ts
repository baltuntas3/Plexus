import type {
  Benchmark,
  BenchmarkCostForecast,
} from "../../../domain/entities/benchmark.js";
import type { TaskType } from "@plexus/shared-types";
import type { IBenchmarkRepository } from "../../../domain/repositories/benchmark-repository.js";
import type { IPromptRepository } from "../../../domain/repositories/prompt-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import { NotFoundError, ValidationError } from "../../../domain/errors/domain-error.js";
import type { CreateBenchmarkDto } from "../../dto/benchmark-dto.js";
import {
  calculateCost,
  ModelRegistry,
  pickGeneratorModel,
  pickJudgeModels,
} from "../../services/model-registry.js";
import {
  TestCaseGenerator,
  buildEvaluationSpecFromVersions,
} from "../../services/benchmark/test-case-generator.js";
import type { IAIProviderFactory } from "../../services/ai-provider.js";

// Creates a benchmark in "draft" status, generating test cases from the
// selected prompt versions so the user can review and optionally annotate them
// with expected outputs before starting the run.
//
// The caller only chooses what to benchmark (versions, solver models) and how
// many cases to probe. Everything that makes a benchmark fair and reproducible
// — judge ensemble, generator model, test-generation mode, repetitions, seed,
// concurrency — is derived here so the surface area stays minimal but the
// defaults are explicit.

const DEFAULT_GENERATOR_MODEL = "openai/gpt-oss-120b";
const DEFAULT_JUDGE_COUNT = 2;
const DEFAULT_REPETITIONS = 3;
const DEFAULT_SOLVER_TEMPERATURE = 0.7;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_BUDGET_USD = 50;

export type CreateBenchmarkCommand = CreateBenchmarkDto & {
  ownerId: string;
};

export interface CreateBenchmarkResult {
  benchmark: Benchmark;
  versionLabels: Record<string, string>;
}

export class CreateBenchmarkUseCase {
  constructor(
    private readonly benchmarks: IBenchmarkRepository,
    private readonly versions: IPromptVersionRepository,
    private readonly providers: IAIProviderFactory,
    private readonly prompts?: IPromptRepository,
  ) {}

  async execute(command: CreateBenchmarkCommand): Promise<CreateBenchmarkResult> {
    const resolvedVersions = await this.loadVersions(command.promptVersionIds);

    for (const model of command.solverModels) {
      ModelRegistry.require(model);
    }

    const judgeModels = pickJudgeModels(
      command.solverModels,
      command.judgeCount ?? DEFAULT_JUDGE_COUNT,
    );
    const generatorModel = pickGeneratorModel(
      command.solverModels,
      command.generatorModel ?? DEFAULT_GENERATOR_MODEL,
    );
    const analysisModel = judgeModels[0] ?? null;
    const testGenerationMode =
      command.testGenerationMode ??
      (resolvedVersions.length > 1 ? "hybrid" : "shared-core");
    const seed = command.seed ?? generateSeed();
    const taskType = await this.resolveTaskType(resolvedVersions);

    const spec = buildEvaluationSpecFromVersions(
      resolvedVersions,
      testGenerationMode,
      seed,
    );
    const generator = new TestCaseGenerator(this.providers);
    const generated = await generator.generate(
      spec,
      command.testCount,
      generatorModel,
      seed,
    );
    const costForecast = estimateBenchmarkCost({
      versions: resolvedVersions,
      generatedInputs: generated.map((tc) => tc.input),
      solverModels: command.solverModels,
      judgeModels,
      repetitions: command.repetitions ?? DEFAULT_REPETITIONS,
    });
    const budgetUsd = command.budgetUsd ?? DEFAULT_BUDGET_USD;
    if (costForecast.estimatedTotalCostUsd > budgetUsd) {
      throw ValidationError(
        `Estimated benchmark cost $${costForecast.estimatedTotalCostUsd.toFixed(4)} exceeds the $${budgetUsd.toFixed(2)} cap. Reduce test count, solver count, or repetitions.`,
      );
    }

    const benchmark = await this.benchmarks.create({
      name: command.name,
      ownerId: command.ownerId,
      promptVersionIds: command.promptVersionIds,
      solverModels: command.solverModels,
      judgeModels,
      generatorModel,
      testGenerationMode,
      analysisModel,
      taskType,
      costForecast,
      testCount: command.testCount,
      repetitions: command.repetitions ?? DEFAULT_REPETITIONS,
      solverTemperature: command.solverTemperature ?? DEFAULT_SOLVER_TEMPERATURE,
      seed,
      testCases: generated.map((tc) => ({
        id: tc.id,
        input: tc.input,
        expectedOutput: null,
        category: tc.category,
        source: "generated" as const,
      })),
      concurrency: command.concurrency ?? DEFAULT_CONCURRENCY,
      cellTimeoutMs: command.cellTimeoutMs ?? null,
      budgetUsd,
    });

    const versionLabels: Record<string, string> = {};
    resolvedVersions.forEach((v, i) => {
      versionLabels[v.id] = v.name?.trim() || v.version || `v${i + 1}`;
    });
    return { benchmark, versionLabels };
  }

  private async resolveTaskType(
    versions: Awaited<ReturnType<CreateBenchmarkUseCase["loadVersions"]>>,
  ): Promise<TaskType> {
    if (!this.prompts) return "general";
    const promptIds = [...new Set(versions.map((version) => version.promptId))];
    const prompts = await Promise.all(promptIds.map((id) => this.prompts?.findById(id)));
    const missing = promptIds.filter((_, index) => !prompts[index]);
    if (missing.length > 0) {
      throw NotFoundError(`Prompt(s) not found: ${missing.join(", ")}`);
    }
    const taskTypes = [...new Set(prompts.map((prompt) => prompt?.taskType ?? "general"))];
    if (taskTypes.length > 1) {
      throw ValidationError(
        `Benchmark versions span multiple task types (${taskTypes.join(", ")}); compare prompts with the same task type`,
      );
    }
    return (taskTypes[0] ?? "general") as TaskType;
  }

  private async loadVersions(ids: string[]) {
    const resolved = await Promise.all(ids.map((id) => this.versions.findById(id)));
    for (let i = 0; i < ids.length; i++) {
      if (!resolved[i]) throw NotFoundError(`PromptVersion ${ids[i]} not found`);
    }
    return resolved as NonNullable<(typeof resolved)[number]>[];
  }
}

const generateSeed = (): number => Math.floor(Math.random() * 0x7fffffff);

const estimateTokenCount = (text: string): number => {
  const matches = text.match(/[\p{L}\p{N}]+(?:['_-][\p{L}\p{N}]+)*|[^\s]/gu);
  return matches?.length ?? 0;
};

export const estimateBenchmarkCost = (input: {
  versions: Awaited<ReturnType<CreateBenchmarkUseCase["loadVersions"]>>;
  generatedInputs: readonly string[];
  solverModels: readonly string[];
  judgeModels: readonly string[];
  repetitions: number;
}): BenchmarkCostForecast => {
  const versionPrompts = input.versions.map((version) =>
    version.braidGraph?.trim() ? version.braidGraph : version.classicalPrompt,
  );
  const avgSystemPromptTokens = average(versionPrompts.map(estimateTokenCount));
  const avgUserInputTokens = average(input.generatedInputs.map(estimateTokenCount));
  const avgCandidateOutputTokens = Math.max(
    64,
    Math.round(avgUserInputTokens * 1.6),
  );
  const estimatedMatrixCells =
    input.generatedInputs.length *
    input.versions.length *
    input.solverModels.length *
    input.repetitions;

  let estimatedCandidateCostUsd = 0;
  for (const solverModel of input.solverModels) {
    const perCell = calculateCost(
      solverModel,
      Math.round(avgSystemPromptTokens + avgUserInputTokens),
      avgCandidateOutputTokens,
    );
    estimatedCandidateCostUsd +=
      perCell.totalUsd *
      input.generatedInputs.length *
      input.versions.length *
      input.repetitions;
  }

  const judgeInputTokensPerVote = Math.round(
    avgSystemPromptTokens * 2 + avgUserInputTokens + avgCandidateOutputTokens + 140,
  );
  const judgeOutputTokensPerVote = 32;
  let estimatedJudgeCostUsd = 0;
  for (const judgeModel of input.judgeModels) {
    const perVote = calculateCost(
      judgeModel,
      judgeInputTokensPerVote,
      judgeOutputTokensPerVote,
    );
    estimatedJudgeCostUsd += perVote.totalUsd * estimatedMatrixCells;
  }

  return {
    estimatedMatrixCells,
    estimatedCandidateInputTokens: Math.round(
      (avgSystemPromptTokens + avgUserInputTokens) * estimatedMatrixCells,
    ),
    estimatedCandidateOutputTokens: avgCandidateOutputTokens * estimatedMatrixCells,
    estimatedJudgeInputTokens:
      judgeInputTokensPerVote * estimatedMatrixCells * input.judgeModels.length,
    estimatedJudgeOutputTokens:
      judgeOutputTokensPerVote * estimatedMatrixCells * input.judgeModels.length,
    estimatedCandidateCostUsd,
    estimatedJudgeCostUsd,
    estimatedTotalCostUsd: estimatedCandidateCostUsd + estimatedJudgeCostUsd,
  };
};

const average = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
