import type { Benchmark } from "../../../domain/entities/benchmark.js";
import { ForbiddenError, NotFoundError } from "../../../domain/errors/domain-error.js";
import type { IBenchmarkRepository } from "../../../domain/repositories/benchmark-repository.js";

export const ensureBenchmarkAccess = async (
  benchmarks: IBenchmarkRepository,
  benchmarkId: string,
  ownerId: string,
): Promise<Benchmark> => {
  const bm = await benchmarks.findById(benchmarkId);
  if (!bm) throw NotFoundError("Benchmark not found");
  if (bm.ownerId !== ownerId) throw ForbiddenError("You don't own this benchmark");
  return bm;
};
