// Forecast of the total USD + token cost a benchmark run is expected to
// incur, given its configuration (versions × solvers × judges × reps × test
// inputs). The estimator that builds it lives in the application layer so it
// can depend on the model pricing registry; the shape itself is pure domain
// so the aggregate can carry it as part of its state.
export interface BenchmarkCostForecast {
  estimatedMatrixCells: number;
  estimatedCandidateInputTokens: number;
  estimatedCandidateOutputTokens: number;
  estimatedJudgeInputTokens: number;
  estimatedJudgeOutputTokens: number;
  estimatedCandidateCostUsd: number;
  estimatedJudgeCostUsd: number;
  estimatedTotalCostUsd: number;
}
