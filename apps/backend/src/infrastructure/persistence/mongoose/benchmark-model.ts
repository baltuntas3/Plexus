import { TASK_TYPES } from "@plexus/shared-types";
import { Schema, model } from "mongoose";

const BENCHMARK_STATUSES = [
  "draft",
  "queued",
  "running",
  "completed",
  "completed_with_budget_cap",
  "failed",
] as const;
const TEST_CASE_CATEGORIES = [
  "typical",
  "complex",
  "ambiguous",
  "adversarial",
  "edge_case",
  "contradictory",
  "stress",
] as const;
const TEST_CASE_SOURCES = ["generated", "manual"] as const;
const TEST_GENERATION_MODES = ["shared-core", "diff-seeking", "hybrid"] as const;
const benchmarkSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    promptVersionIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "PromptVersion" }],
      required: true,
    },
    solverModels: { type: [String], required: true },
    judgeModels: { type: [String], required: true },
    generatorModel: { type: String, required: true },
    testGenerationMode: {
      type: String,
      enum: TEST_GENERATION_MODES,
      required: true,
      default: "shared-core",
    },
    analysisModel: { type: String, default: null },
    taskType: {
      type: String,
      enum: TASK_TYPES,
      required: true,
      default: "general",
    },
    costForecast: {
      type: {
        estimatedMatrixCells: { type: Number, required: true, min: 0 },
        estimatedCandidateInputTokens: { type: Number, required: true, min: 0 },
        estimatedCandidateOutputTokens: { type: Number, required: true, min: 0 },
        estimatedJudgeInputTokens: { type: Number, required: true, min: 0 },
        estimatedJudgeOutputTokens: { type: Number, required: true, min: 0 },
        estimatedCandidateCostUsd: { type: Number, required: true, min: 0 },
        estimatedJudgeCostUsd: { type: Number, required: true, min: 0 },
        estimatedTotalCostUsd: { type: Number, required: true, min: 0 },
      },
      default: null,
    },
    testCount: { type: Number, required: true, min: 1, max: 50 },
    repetitions: { type: Number, required: true, min: 1, max: 20, default: 3 },
    solverTemperature: { type: Number, required: true, default: 0.7 },
    seed: { type: Number, required: true, default: 0 },
    testCases: {
      type: [
        {
          id: { type: String, required: true },
          input: { type: String, required: true },
          expectedOutput: { type: String, default: null },
          category: {
            type: String,
            enum: TEST_CASE_CATEGORIES,
            default: null,
          },
          source: {
            type: String,
            enum: TEST_CASE_SOURCES,
            required: true,
            default: "generated",
          },
        },
      ],
      default: [],
    },
    concurrency: { type: Number, required: true, min: 1, max: 16 },
    cellTimeoutMs: { type: Number, default: null, min: 1000 },
    budgetUsd: { type: Number, default: 50, min: 0.01, max: 50 },
    status: {
      type: String,
      enum: BENCHMARK_STATUSES,
      required: true,
      default: "draft",
      index: true,
    },
    progress: {
      completed: { type: Number, required: true, default: 0 },
      total: { type: Number, required: true, default: 0 },
    },
    jobId: { type: String, default: null },
    error: { type: String, default: null },
    // Optimistic-concurrency token bumped on every aggregate save. Filtering
    // by this on update guarantees lost-update detection if two writers ever
    // race (the runner and a user edit path are the plausible offenders).
    revision: { type: Number, required: true, default: 0 },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

benchmarkSchema.index({ ownerId: 1, createdAt: -1 });

export const BenchmarkModel = model("Benchmark", benchmarkSchema);
