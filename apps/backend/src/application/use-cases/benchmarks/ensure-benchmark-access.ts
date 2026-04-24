import type { Benchmark } from "../../../domain/entities/benchmark.js";
import { BenchmarkNotFoundError } from "../../../domain/errors/domain-error.js";
import type { IBenchmarkRepository } from "../../../domain/repositories/benchmark-repository.js";

// Load-and-guard helper shared by every benchmark write use case. Encodes
// the "find → not-found → assert ownership" triad in one place so the
// forbidden vs. not-found distinction stays consistent and no caller can
// accidentally skip the ownership check. Uses the domain-native
// BenchmarkNotOwnedError (via assertOwnedBy) rather than a generic HTTP
// error name, so presentation stays the layer that cares about 403 vs 404.
export const ensureBenchmarkAccess = async (
  benchmarks: IBenchmarkRepository,
  benchmarkId: string,
  ownerId: string,
): Promise<Benchmark> => {
  const benchmark = await benchmarks.findById(benchmarkId);
  if (!benchmark) {
    throw BenchmarkNotFoundError(benchmarkId);
  }
  benchmark.assertOwnedBy(ownerId);
  return benchmark;
};
