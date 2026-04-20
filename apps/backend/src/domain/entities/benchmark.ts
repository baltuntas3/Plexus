import type { TaskType } from "@plexus/shared-types";

// Benchmark = "evaluate these prompt versions against each other using
// LLM-generated test inputs, scored by an ensemble of judge models". Test
// inputs are produced at run time by a generator model that reads the prompt
// content and produces `testCount` varied, realistic user messages.
//
// Each (testCase × promptVersion × solverModel) cell is executed `repetitions`
// times so variance across runs can be estimated. Each run is graded by EVERY
// judge in `judgeModels` and scores are averaged across judges to reduce
// single-judge bias.
//
// `seed` is the deterministic seed for both test-case generation and solver
// sampling. It is generated at benchmark creation (unless provided explicitly)
// so reruns of the same benchmark produce the same candidate outputs —
// variance across the k repetitions is still present because each run uses
// `seed ⊕ hash(cell, runIndex)`.
//
// Each PromptVersion uses its own prompt for evaluation: if the version has a
// braidGraph, that graph is the prompt; otherwise the classicalPrompt is used.
// There is no separate "mode" dimension — the version itself determines which
// prompt format is active.

export type BenchmarkStatus = "draft" | "queued" | "running" | "completed" | "failed";

export interface BenchmarkProgress {
  completed: number;
  total: number;
}

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

// Test-case categories mirror the labels the generator LLM is asked to produce.
// "manual" is reserved for cases the user adds by hand and for which the
// generator never assigned a category.
export const TEST_CASE_CATEGORIES = [
  "typical",
  "complex",
  "ambiguous",
  "adversarial",
  "edge_case",
  "contradictory",
  "stress",
] as const;
export type TestCaseCategory = (typeof TEST_CASE_CATEGORIES)[number];

export type TestCaseSource = "generated" | "manual";
export type TestGenerationMode = "shared-core" | "diff-seeking";

export interface BenchmarkTestCase {
  id: string;
  input: string;
  expectedOutput: string | null;
  // Null when the source is "manual" and the user has not labelled the case,
  // or for historical rows written before categorisation existed.
  category: TestCaseCategory | null;
  source: TestCaseSource;
}

export interface Benchmark {
  id: string;
  name: string;
  ownerId: string;
  promptVersionIds: string[];
  solverModels: string[];
  judgeModels: string[];
  generatorModel: string;
  testGenerationMode: TestGenerationMode;
  // Model used for the natural-language analysis commentary. Independent of
  // judge models so the narrative layer is not tied to grading. Falls back to
  // the first judge model when null.
  analysisModel: string | null;
  taskType: TaskType;
  costForecast: BenchmarkCostForecast | null;
  testCount: number;
  repetitions: number;
  solverTemperature: number;
  seed: number;
  concurrency: number;
  cellTimeoutMs: number | null;
  budgetUsd: number | null;
  status: BenchmarkStatus;
  progress: BenchmarkProgress;
  testCases: BenchmarkTestCase[];
  jobId: string | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}
