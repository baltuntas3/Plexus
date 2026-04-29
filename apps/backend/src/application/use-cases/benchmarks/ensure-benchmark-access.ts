import type { Benchmark } from "../../../domain/entities/benchmark.js";
import { BenchmarkNotFoundError } from "../../../domain/errors/domain-error.js";
import type { IBenchmarkRepository } from "../../../domain/repositories/benchmark-repository.js";

// Load-and-guard helper shared by every benchmark write use case. The
// repository collapses missing and cross-org into a single `null` so the
// caller cannot tell an unscoped benchmark apart from one that never
// existed — 403 vs 404 discrimination would leak existence via id
// enumeration across tenant boundaries.
export const ensureBenchmarkAccess = async (
  benchmarks: IBenchmarkRepository,
  benchmarkId: string,
  organizationId: string,
): Promise<Benchmark> => {
  const benchmark = await benchmarks.findInOrganization(
    benchmarkId,
    organizationId,
  );
  if (!benchmark) {
    throw BenchmarkNotFoundError(benchmarkId);
  }
  return benchmark;
};
