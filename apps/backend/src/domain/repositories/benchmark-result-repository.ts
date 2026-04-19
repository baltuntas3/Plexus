import type { BenchmarkResult } from "../entities/benchmark-result.js";

// Result rows are written via upsert keyed on
// (benchmarkId, testCaseId, promptVersionId, solverModel, runIndex) so a
// runner restart is naturally idempotent: re-running an already-recorded row
// is a no-op, and `findExistingKeys` lets the runner skip them up front.
//
// `updateScores` is used by the post-run verbosity pass to rewrite
// verbosityPenalty + finalScore on completed rows that had no expected output.
// The fallback penalty is computed once all rows are written, against the
// per-test-case median candidate length, so reference-free rows do not remain
// permanently unpenalised for verbosity.

export type UpsertBenchmarkResultInput = Omit<BenchmarkResult, "id" | "createdAt">;

export interface UpdateScoresInput {
  id: string;
  verbosityPenalty: number;
  finalScore: number;
}

export interface IBenchmarkResultRepository {
  upsert(input: UpsertBenchmarkResultInput): Promise<BenchmarkResult>;
  listByBenchmark(benchmarkId: string): Promise<BenchmarkResult[]>;
  findExistingKeys(benchmarkId: string): Promise<Set<string>>;
  updateScores(input: UpdateScoresInput): Promise<void>;
}
