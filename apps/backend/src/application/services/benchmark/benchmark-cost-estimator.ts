import type { BenchmarkCostForecast } from "../../../domain/value-objects/benchmark-cost-forecast.js";
import type { PromptVersionSummary } from "../../queries/prompt-query-service.js";
import { calculateCost } from "../model-registry.js";

// Cost forecasting for a benchmark configuration. Lives in the application
// layer because pricing comes from the model registry (a provider-aware
// infrastructure-adjacent port), but the output shape is a pure domain VO
// the aggregate carries around. Extracted from the create-benchmark use
// case so start-benchmark and update-test-cases stop importing from a
// peer use-case file.

export interface BenchmarkCostEstimatorInput {
  versions: readonly PromptVersionSummary[];
  generatedInputs: readonly string[];
  solverModels: readonly string[];
  judgeModels: readonly string[];
  repetitions: number;
}

export class BenchmarkCostEstimator {
  estimate(input: BenchmarkCostEstimatorInput): BenchmarkCostForecast {
    const versionPrompts = input.versions.map((v) => v.executablePrompt);
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
      avgSystemPromptTokens * 2 +
        avgUserInputTokens +
        avgCandidateOutputTokens +
        140,
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
      estimatedCandidateOutputTokens:
        avgCandidateOutputTokens * estimatedMatrixCells,
      estimatedJudgeInputTokens:
        judgeInputTokensPerVote *
        estimatedMatrixCells *
        input.judgeModels.length,
      estimatedJudgeOutputTokens:
        judgeOutputTokensPerVote *
        estimatedMatrixCells *
        input.judgeModels.length,
      estimatedCandidateCostUsd,
      estimatedJudgeCostUsd,
      estimatedTotalCostUsd: estimatedCandidateCostUsd + estimatedJudgeCostUsd,
    };
  }
}

const estimateTokenCount = (text: string): number => {
  const matches = text.match(/[\p{L}\p{N}]+(?:['_-][\p{L}\p{N}]+)*|[^\s]/gu);
  return matches?.length ?? 0;
};

const average = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
