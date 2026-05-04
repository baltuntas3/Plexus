import { Schema, model } from "mongoose";

const RESULT_STATUSES = ["completed", "failed"] as const;
const FAILURE_KINDS = [
  "timeout",
  "solver_error",
  "judge_error",
  "unknown",
] as const;

// One row per (benchmarkId × testCaseId × promptVersionId × solverModel ×
// runIndex). The compound unique index is the idempotency contract that lets
// the runner safely resume after a restart — an upsert on this key will
// update the existing row rather than create a duplicate. The runIndex is
// part of the key so k-run repetitions are distinct rows that can be
// aggregated for variance analysis.

const judgeVoteSchema = new Schema(
  {
    model: { type: String, required: true },
    accuracy: { type: Number, required: true },
    coherence: { type: Number, required: true },
    instruction: { type: Number, required: true },
    reasoning: { type: String, required: true, default: "" },
    inputTokens: { type: Number, required: true, default: 0 },
    outputTokens: { type: Number, required: true, default: 0 },
    costUsd: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

const benchmarkResultSchema = new Schema(
  {
    // The compound unique index below already covers `benchmarkId` as its prefix.
    benchmarkId: {
      type: Schema.Types.ObjectId,
      ref: "Benchmark",
      required: true,
    },
    testCaseId: { type: String, required: true },
    promptVersionId: {
      type: Schema.Types.ObjectId,
      ref: "PromptVersion",
      required: true,
    },
    solverModel: { type: String, required: true },
    runIndex: { type: Number, required: true, default: 0, min: 0 },

    candidateOutput: { type: String, required: true, default: "" },

    // Per-row rubric means and `finalScore` are NOT persisted — they derive
    // from `judgeVotes` via `judgeRubricAggregate`. The row-level `input`
    // string is also not stored: `testCaseId` resolves to the canonical
    // `Benchmark.testCases[i].input` (test cases are immutable once a
    // benchmark leaves draft state, so the lookup is safe).
    judgeVotes: { type: [judgeVoteSchema], default: [] },

    candidateInputTokens: { type: Number, required: true, default: 0 },
    candidateOutputTokens: { type: Number, required: true, default: 0 },
    candidateCostUsd: { type: Number, required: true, default: 0 },
    judgeInputTokens: { type: Number, required: true, default: 0 },
    judgeOutputTokens: { type: Number, required: true, default: 0 },
    judgeCostUsd: { type: Number, required: true, default: 0 },
    totalCostUsd: { type: Number, required: true, default: 0 },
    judgeFailureCount: { type: Number, required: true, default: 0, min: 0 },

    solverLatencyMs: { type: Number, required: true, default: 0 },
    status: { type: String, enum: RESULT_STATUSES, required: true },
    failureKind: { type: String, enum: FAILURE_KINDS, default: null },
    error: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

benchmarkResultSchema.index(
  { benchmarkId: 1, testCaseId: 1, promptVersionId: 1, solverModel: 1, runIndex: 1 },
  { unique: true },
);

export const BenchmarkResultModel = model("BenchmarkResult", benchmarkResultSchema);
