import type { BenchmarkAnalysis } from "../../services/benchmark/benchmark-analyzer.js";
import { analyzeBenchmark } from "../../services/benchmark/benchmark-analyzer.js";
import type { IBenchmarkRepository } from "../../../domain/repositories/benchmark-repository.js";
import type { IBenchmarkResultRepository } from "../../../domain/repositories/benchmark-result-repository.js";
import { ensureBenchmarkAccess } from "./ensure-benchmark-access.js";

export interface GetBenchmarkAnalysisCommand {
  benchmarkId: string;
  ownerId: string;
}

export class GetBenchmarkAnalysisUseCase {
  constructor(
    private readonly benchmarks: IBenchmarkRepository,
    private readonly results: IBenchmarkResultRepository,
  ) {}

  async execute(command: GetBenchmarkAnalysisCommand): Promise<BenchmarkAnalysis> {
    await ensureBenchmarkAccess(
      this.benchmarks,
      command.benchmarkId,
      command.ownerId,
    );
    const results = await this.results.listByBenchmark(command.benchmarkId);
    return analyzeBenchmark(results);
  }
}
