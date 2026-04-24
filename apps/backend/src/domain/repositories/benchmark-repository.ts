import type { Benchmark } from "../entities/benchmark.js";

// Write-side port for the Benchmark aggregate. Mirrors the Prompt aggregate
// repository: a single `save(benchmark)` entry point that atomically
// persists the aggregate under optimistic-concurrency (via the revision
// field) so partial-update surface area stays at zero. Read projections
// live on IBenchmarkQueryService.

export interface IBenchmarkRepository {
  findById(id: string): Promise<Benchmark | null>;
  // save advances the aggregate's revision on success and throws
  // BenchmarkAggregateStaleError when the optimistic-concurrency check fails.
  save(benchmark: Benchmark): Promise<void>;
}
