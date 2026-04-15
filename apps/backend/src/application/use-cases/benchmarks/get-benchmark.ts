import type { Benchmark } from "../../../domain/entities/benchmark.js";
import type { BenchmarkResult } from "../../../domain/entities/benchmark-result.js";
import type { IBenchmarkRepository } from "../../../domain/repositories/benchmark-repository.js";
import type { IBenchmarkResultRepository } from "../../../domain/repositories/benchmark-result-repository.js";
import { ensureBenchmarkAccess } from "./ensure-benchmark-access.js";

export interface GetBenchmarkCommand {
  benchmarkId: string;
  ownerId: string;
}

export interface GetBenchmarkResult {
  benchmark: Benchmark;
  results: BenchmarkResult[];
}

export class GetBenchmarkUseCase {
  constructor(
    private readonly benchmarks: IBenchmarkRepository,
    private readonly results: IBenchmarkResultRepository,
  ) {}

  async execute(command: GetBenchmarkCommand): Promise<GetBenchmarkResult> {
    const benchmark = await ensureBenchmarkAccess(
      this.benchmarks,
      command.benchmarkId,
      command.ownerId,
    );
    const results = await this.results.listByBenchmark(benchmark.id);
    return { benchmark, results };
  }
}
