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
// Each row is graded by every judge in the benchmark's `judgeModels`. The
// individual votes are persisted on `judgeVotes` — that's the canonical
// store. Per-row rubric means and `finalScore` are NOT persisted; they are
// derived from `judgeVotes` via `judgeRubricAggregate` so there is one
// source of truth.

import { ValidationError } from "../errors/domain-error.js";

export type BenchmarkResultStatus = "completed" | "failed";
export type BenchmarkFailureKind =
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

  candidateOutput: string;

  // Canonical store for grading. Per-row rubric means and finalScore are
  // derived via `judgeRubricAggregate(judgeVotes)`.
  judgeVotes: JudgeVote[];

  candidateInputTokens: number;
  candidateOutputTokens: number;
  candidateCostUsd: number;
  // Judge token/cost aggregates capture both successful votes AND partial
  // failures (where votes are absent), so they are NOT derivable from
  // `judgeVotes` alone — they stay on the row.
  judgeInputTokens: number;
  judgeOutputTokens: number;
  judgeCostUsd: number;
  totalCostUsd: number;
  judgeFailureCount: number;

  // Canonical latency metric for benchmark comparison: only the solver model's
  // answer-generation call, not judge/evaluation overhead.
  solverLatencyMs: number;
  status: BenchmarkResultStatus;
  failureKind: BenchmarkFailureKind | null;
  error: string | null;
  createdAt: Date;
}

// Derives the per-row rubric mean and `finalScore` (normalised to [0,1])
// from the canonical judge votes. Empty votes (failed rows) collapse to
// zero on every axis; downstream analysis only consumes these from
// completed rows so the zero is never confused with a real grade.
interface JudgeRubricAggregate {
  accuracy: number;
  coherence: number;
  instruction: number;
  finalScore: number;
}

export const judgeRubricAggregate = (
  votes: readonly JudgeVote[],
): JudgeRubricAggregate => {
  if (votes.length === 0) {
    return { accuracy: 0, coherence: 0, instruction: 0, finalScore: 0 };
  }
  let accuracySum = 0;
  let coherenceSum = 0;
  let instructionSum = 0;
  for (const v of votes) {
    accuracySum += v.accuracy;
    coherenceSum += v.coherence;
    instructionSum += v.instruction;
  }
  const accuracy = accuracySum / votes.length;
  const coherence = coherenceSum / votes.length;
  const instruction = instructionSum / votes.length;
  // `(rubricMean - 1) / 4` matches `buildJudgeScore`'s contract: maps the
  // 1..5 rubric mean into [0,1] so analyzer math stays unitless.
  const finalScore = ((accuracy + coherence + instruction) / 3 - 1) / 4;
  return { accuracy, coherence, instruction, finalScore };
};

// Shape persisted by the repository — `id` and `createdAt` are assigned by
// the store, everything else comes from the factory below.
export type UpsertableBenchmarkResult = Omit<BenchmarkResult, "id" | "createdAt">;

export interface CompletedResultInput {
  benchmarkId: string;
  testCaseId: string;
  promptVersionId: string;
  solverModel: string;
  runIndex: number;

  candidateOutput: string;
  candidateInputTokens: number;
  candidateOutputTokens: number;
  candidateCostUsd: number;

  judgeVotes: readonly JudgeVote[];
  judgeInputTokens: number;
  judgeOutputTokens: number;
  judgeCostUsd: number;
  judgeFailureCount: number;

  solverLatencyMs: number;
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

    candidateOutput: input.candidateOutput,

    judgeVotes: [...input.judgeVotes],

    candidateInputTokens: input.candidateInputTokens,
    candidateOutputTokens: input.candidateOutputTokens,
    candidateCostUsd: input.candidateCostUsd,
    judgeInputTokens: input.judgeInputTokens,
    judgeOutputTokens: input.judgeOutputTokens,
    judgeCostUsd: input.judgeCostUsd,
    totalCostUsd: input.candidateCostUsd + input.judgeCostUsd,
    judgeFailureCount: input.judgeFailureCount,

    solverLatencyMs: input.solverLatencyMs,
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
  solverLatencyMs?: number;
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

    candidateOutput: input.candidateOutput ?? "",

    judgeVotes: [],

    candidateInputTokens: input.candidateInputTokens ?? 0,
    candidateOutputTokens: input.candidateOutputTokens ?? 0,
    candidateCostUsd,
    judgeInputTokens: input.judgeInputTokens ?? 0,
    judgeOutputTokens: input.judgeOutputTokens ?? 0,
    judgeCostUsd,
    totalCostUsd: candidateCostUsd + judgeCostUsd,
    judgeFailureCount: input.judgeFailureCount ?? 0,

    solverLatencyMs: input.solverLatencyMs ?? 0,
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
