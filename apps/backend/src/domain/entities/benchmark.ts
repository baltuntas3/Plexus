// Benchmark = "evaluate these prompt versions against each other using
// LLM-generated test inputs, scored by this judge model". Test inputs are
// produced at run time by a generator model that reads the prompt content and
// produces `testCount` varied, realistic user messages.
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

export interface BenchmarkTestCase {
  id: string;
  input: string;
  expectedOutput: string | null;
}

export interface Benchmark {
  id: string;
  name: string;
  ownerId: string;
  promptVersionIds: string[];
  solverModels: string[];
  judgeModel: string;
  generatorModel: string;
  testCount: number;
  concurrency: number;
  status: BenchmarkStatus;
  progress: BenchmarkProgress;
  testCases: BenchmarkTestCase[];
  jobId: string | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}
