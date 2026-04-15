import type { BenchmarkResult } from "../entities/benchmark-result.js";

// Result rows are written via upsert keyed on
// (benchmarkId, testCaseId, promptVersionId, solverModel) so a runner restart
// is naturally idempotent: re-running an already-completed cell is a no-op,
// and `findCompletedKeys` lets the runner skip them up front.

export type UpsertBenchmarkResultInput = Omit<BenchmarkResult, "id" | "createdAt">;

export interface IBenchmarkResultRepository {
  upsert(input: UpsertBenchmarkResultInput): Promise<BenchmarkResult>;
  listByBenchmark(benchmarkId: string): Promise<BenchmarkResult[]>;
  findCompletedKeys(benchmarkId: string): Promise<Set<string>>;
}
