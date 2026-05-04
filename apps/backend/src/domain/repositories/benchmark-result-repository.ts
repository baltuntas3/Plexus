import type {
  BenchmarkResult,
  UpsertableBenchmarkResult,
} from "../entities/benchmark-result.js";

// Result rows are written via upsert keyed on
// (benchmarkId, testCaseId, promptVersionId, solverModel, runIndex) so a
// runner restart is naturally idempotent: re-running an already-recorded
// row is a no-op. The runner reads the existing rows via `listByBenchmark`
// when resuming, then skips any whose key is already present.
//
// `UpsertableBenchmarkResult` is produced by the
// `completedBenchmarkResult` / `failedBenchmarkResult` factories so
// "failed without error" and "completed without votes" become type-safe.

export interface IBenchmarkResultRepository {
  upsert(input: UpsertableBenchmarkResult): Promise<BenchmarkResult>;
  listByBenchmark(benchmarkId: string): Promise<BenchmarkResult[]>;
}
