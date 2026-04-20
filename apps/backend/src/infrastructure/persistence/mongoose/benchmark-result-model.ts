import { Schema, model } from "mongoose";

const RESULT_STATUSES = ["completed", "failed"] as const;
const FAILURE_KINDS = [
  "budget_exceeded",
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
    benchmarkId: {
      type: Schema.Types.ObjectId,
      ref: "Benchmark",
      required: true,
      index: true,
    },
    testCaseId: { type: String, required: true },
    promptVersionId: {
      type: Schema.Types.ObjectId,
      ref: "PromptVersion",
      required: true,
    },
    solverModel: { type: String, required: true },
    runIndex: { type: Number, required: true, default: 0, min: 0 },

    input: { type: String, required: true },
    candidateOutput: { type: String, required: true, default: "" },

    judgeAccuracy: { type: Number, required: true },
    judgeCoherence: { type: Number, required: true },
    judgeInstruction: { type: Number, required: true },
    judgeVotes: { type: [judgeVoteSchema], default: [] },
    rawScore: { type: Number, required: true },
    verbosityPenalty: { type: Number, required: true },
    finalScore: { type: Number, required: true },
    exactMatch: { type: Boolean, default: null },
    fuzzyMatchScore: { type: Number, default: null },

    candidateInputTokens: { type: Number, required: true, default: 0 },
    candidateOutputTokens: { type: Number, required: true, default: 0 },
    candidateCostUsd: { type: Number, required: true, default: 0 },
    judgeInputTokens: { type: Number, required: true, default: 0 },
    judgeOutputTokens: { type: Number, required: true, default: 0 },
    judgeCostUsd: { type: Number, required: true, default: 0 },
    totalCostUsd: { type: Number, required: true, default: 0 },
    judgeFailureCount: { type: Number, required: true, default: 0, min: 0 },

    latencyMs: { type: Number, required: true, default: 0 },
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
