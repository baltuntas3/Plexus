import type { Benchmark } from "../entities/benchmark.js";

// Write-side port for the Benchmark aggregate. Mirrors the Prompt aggregate
// repository: a single `save(benchmark)` entry point that atomically
// persists the aggregate under optimistic-concurrency (via the revision
// field) so partial-update surface area stays at zero. Read projections
// live on IBenchmarkQueryService.

export interface IBenchmarkRepository {
  // Unscoped lookup. Used by internal paths (e.g. the runner, which resumes
  // a benchmark by id under a system job context). User-facing write use
  // cases must use `findOwnedById` so foreign aggregates do not leak as
  // 403s via id enumeration.
  findById(id: string): Promise<Benchmark | null>;
  // Owner-scoped lookup. Collapses "missing" and "owned by someone else"
  // into a single `null` so presentation can uniformly 404.
  findOwnedById(id: string, ownerId: string): Promise<Benchmark | null>;
  // save advances the aggregate's revision on success and throws
  // BenchmarkAggregateStaleError when the optimistic-concurrency check fails.
  save(benchmark: Benchmark): Promise<void>;
}
