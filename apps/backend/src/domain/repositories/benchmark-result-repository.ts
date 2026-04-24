import type {
  BenchmarkResult,
  UpsertableBenchmarkResult,
} from "../entities/benchmark-result.js";

// Result rows are written via upsert keyed on
// (benchmarkId, testCaseId, promptVersionId, solverModel, runIndex) so a
// runner restart is naturally idempotent: re-running an already-recorded row
// is a no-op, and `findExistingKeys` lets the runner skip them up front.
//
// `updateScores` rewrites verbosityPenalty + finalScore on completed rows when
// scoring logic is adjusted after the initial write.

// Alias kept for callers that still reference the old name. The canonical
// shape is UpsertableBenchmarkResult on the entity file, produced by the
// `completedBenchmarkResult` / `failedBenchmarkResult` factories so
// "failed without error" and "completed without votes" become type-safe.
export type UpsertBenchmarkResultInput = UpsertableBenchmarkResult;

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
