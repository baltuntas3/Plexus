// One cell × run of a benchmark matrix: a single (testCase × promptVersion ×
// solverModel × runIndex) execution. The unique key (benchmarkId, testCaseId,
// promptVersionId, solverModel, runIndex) is what makes restart-safe runs
// idempotent — the runner skips any row already present with status
// "completed".
//
// The prompt used for each cell is determined by the PromptVersion itself:
// if braidGraph is set, the BRAID graph is the system prompt; otherwise the
// sourcePrompt is used. There is no separate mode field.
//
// Each row is graded by every judge in the benchmark's `judgeModels`; the
// individual votes are stored on `judgeVotes` and the aggregated mean
// (accuracy, coherence, instruction) is kept on the row for fast analysis.

import { ValidationError } from "../errors/domain-error.js";

export type BenchmarkResultStatus = "completed" | "failed";
export type BenchmarkFailureKind =
  | "budget_exceeded"
  | "timeout"
  | "solver_error"
  | "judge_error"
  | "unknown";

export interface JudgeVote {
  model: string;
  accuracy: number;
  coherence: number;
  instruction: number;
  reasoning: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface BenchmarkResult {
  id: string;
  benchmarkId: string;
  testCaseId: string;
  promptVersionId: string;
  solverModel: string;
  runIndex: number;

  input: string;
  candidateOutput: string;

  // Rubric values are means across the judge ensemble (1..5). finalScore is
  // the normalised rubric mean in [0,1] (matching JudgeScore's contract).
  // Length expectations belong in the prompt; the judge's `instruction`
  // axis already grades whether the candidate respected them, so there is
  // no separate length-penalty layer.
  judgeAccuracy: number;
  judgeCoherence: number;
  judgeInstruction: number;
  judgeVotes: JudgeVote[];
  finalScore: number;

  candidateInputTokens: number;
  candidateOutputTokens: number;
  candidateCostUsd: number;
  judgeInputTokens: number;
  judgeOutputTokens: number;
  judgeCostUsd: number;
  totalCostUsd: number;
  judgeFailureCount: number;

  latencyMs: number;
  status: BenchmarkResultStatus;
  failureKind: BenchmarkFailureKind | null;
  error: string | null;
  createdAt: Date;
}

// Shape persisted by the repository — `id` and `createdAt` are assigned by
// the store, everything else comes from the factory below.
export type UpsertableBenchmarkResult = Omit<BenchmarkResult, "id" | "createdAt">;

export interface CompletedResultInput {
  benchmarkId: string;
  testCaseId: string;
  promptVersionId: string;
  solverModel: string;
  runIndex: number;

  input: string;
  candidateOutput: string;
  candidateInputTokens: number;
  candidateOutputTokens: number;
  candidateCostUsd: number;

  judgeAccuracy: number;
  judgeCoherence: number;
  judgeInstruction: number;
  judgeVotes: readonly JudgeVote[];
  finalScore: number;
  judgeInputTokens: number;
  judgeOutputTokens: number;
  judgeCostUsd: number;
  judgeFailureCount: number;

  latencyMs: number;
  partialJudgeFailureMessage: string | null;
}

// `completed` requires at least one successful judge vote — a completed row
// with no judge output is not a valid domain state, that's what `failed`
// with failureKind="judge_error" is for.
export const completedBenchmarkResult = (
  input: CompletedResultInput,
): UpsertableBenchmarkResult => {
  if (input.judgeVotes.length === 0) {
    throw ValidationError(
      "Completed benchmark result must include at least one judge vote",
    );
  }
  return {
    benchmarkId: input.benchmarkId,
    testCaseId: input.testCaseId,
    promptVersionId: input.promptVersionId,
    solverModel: input.solverModel,
    runIndex: input.runIndex,

    input: input.input,
    candidateOutput: input.candidateOutput,

    judgeAccuracy: input.judgeAccuracy,
    judgeCoherence: input.judgeCoherence,
    judgeInstruction: input.judgeInstruction,
    judgeVotes: [...input.judgeVotes],
    finalScore: input.finalScore,

    candidateInputTokens: input.candidateInputTokens,
    candidateOutputTokens: input.candidateOutputTokens,
    candidateCostUsd: input.candidateCostUsd,
    judgeInputTokens: input.judgeInputTokens,
    judgeOutputTokens: input.judgeOutputTokens,
    judgeCostUsd: input.judgeCostUsd,
    totalCostUsd: input.candidateCostUsd + input.judgeCostUsd,
    judgeFailureCount: input.judgeFailureCount,

    latencyMs: input.latencyMs,
    status: "completed",
    failureKind: null,
    error: input.partialJudgeFailureMessage,
  };
};

export interface FailedResultInput {
  benchmarkId: string;
  testCaseId: string;
  promptVersionId: string;
  solverModel: string;
  runIndex: number;

  input: string;
  failureKind: BenchmarkFailureKind;
  error: string;

  candidateOutput?: string;
  candidateInputTokens?: number;
  candidateOutputTokens?: number;
  candidateCostUsd?: number;
  judgeInputTokens?: number;
  judgeOutputTokens?: number;
  judgeCostUsd?: number;
  judgeFailureCount?: number;
  latencyMs?: number;
}

// `failed` enforces the domain invariant that a failed row must carry a
// non-empty `error` message — previously the runner built this by hand and
// the type system could not stop a caller from passing `error: null` here.
export const failedBenchmarkResult = (
  input: FailedResultInput,
): UpsertableBenchmarkResult => {
  if (input.error.trim().length === 0) {
    throw ValidationError("Failed benchmark result must carry a non-empty error");
  }
  const candidateCostUsd = input.candidateCostUsd ?? 0;
  const judgeCostUsd = input.judgeCostUsd ?? 0;
  return {
    benchmarkId: input.benchmarkId,
    testCaseId: input.testCaseId,
    promptVersionId: input.promptVersionId,
    solverModel: input.solverModel,
    runIndex: input.runIndex,

    input: input.input,
    candidateOutput: input.candidateOutput ?? "",

    judgeAccuracy: 0,
    judgeCoherence: 0,
    judgeInstruction: 0,
    judgeVotes: [],
    finalScore: 0,

    candidateInputTokens: input.candidateInputTokens ?? 0,
    candidateOutputTokens: input.candidateOutputTokens ?? 0,
    candidateCostUsd,
    judgeInputTokens: input.judgeInputTokens ?? 0,
    judgeOutputTokens: input.judgeOutputTokens ?? 0,
    judgeCostUsd,
    totalCostUsd: candidateCostUsd + judgeCostUsd,
    judgeFailureCount: input.judgeFailureCount ?? 0,

    latencyMs: input.latencyMs ?? 0,
    status: "failed",
    failureKind: input.failureKind,
    error: input.error,
  };
};

// Stable identifier for the (testCase, version, solver, runIndex) row. The
// runner uses it to look up which rows are already recorded on a resume.
export const benchmarkResultKey = (
  testCaseId: string,
  promptVersionId: string,
  solverModel: string,
  runIndex: number,
): string => `${testCaseId}::${promptVersionId}::${solverModel}::${runIndex}`;
