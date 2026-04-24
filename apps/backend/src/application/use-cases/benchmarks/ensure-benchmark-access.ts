import type { Benchmark } from "../../../domain/entities/benchmark.js";
import { BenchmarkNotFoundError } from "../../../domain/errors/domain-error.js";
import type { IBenchmarkRepository } from "../../../domain/repositories/benchmark-repository.js";

// Load-and-guard helper shared by every benchmark write use case. The
// repository collapses missing and foreign-owned into a single `null` so
// the caller cannot tell an unowned benchmark apart from one that never
// existed — 403 vs 404 discrimination would leak existence via id
// enumeration. `assertOwnedBy` on the aggregate remains as defense-in-depth
// for paths that bypass a repository.
export const ensureBenchmarkAccess = async (
  benchmarks: IBenchmarkRepository,
  benchmarkId: string,
  ownerId: string,
): Promise<Benchmark> => {
  const benchmark = await benchmarks.findOwnedById(benchmarkId, ownerId);
  if (!benchmark) {
    throw BenchmarkNotFoundError(benchmarkId);
  }
  return benchmark;
};
