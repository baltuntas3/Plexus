import type { BenchmarkResult } from "../entities/benchmark-result.js";

// Result rows are written via upsert keyed on
// (benchmarkId, testCaseId, promptVersionId, solverModel, runIndex) so a
// runner restart is naturally idempotent: re-running an already-completed row
// is a no-op, and `findCompletedKeys` lets the runner skip them up front.
//
// `updateScores` is used by the post-run verbosity pass to rewrite
// verbosityPenalty + finalScore on rows that had no expected output — the
// penalty there is computed relative to the benchmark's median candidate
// length, which is only known once all rows are written.

export type UpsertBenchmarkResultInput = Omit<BenchmarkResult, "id" | "createdAt">;

export interface UpdateScoresInput {
  id: string;
  verbosityPenalty: number;
  finalScore: number;
}

export interface IBenchmarkResultRepository {
  upsert(input: UpsertBenchmarkResultInput): Promise<BenchmarkResult>;
  listByBenchmark(benchmarkId: string): Promise<BenchmarkResult[]>;
  findCompletedKeys(benchmarkId: string): Promise<Set<string>>;
  updateScores(input: UpdateScoresInput): Promise<void>;
}
