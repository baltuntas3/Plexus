import type { BenchmarkAnalysis } from "../../services/benchmark/benchmark-analyzer.js";
import type { BenchmarkAnalyzer } from "../../services/benchmark/benchmark-analyzer.js";
import type { IBenchmarkRepository } from "../../../domain/repositories/benchmark-repository.js";
import type { IBenchmarkResultRepository } from "../../../domain/repositories/benchmark-result-repository.js";
import { ensureBenchmarkAccess } from "./ensure-benchmark-access.js";

// Loads the raw rows for a benchmark and hands them to the unified analyzer.
// Commentary uses the benchmark's configured analysisModel if set, otherwise
// falls back to the first judge model. Analysis numbers are deterministic;
// only the commentary model is configurable.

export interface GetBenchmarkAnalysisCommand {
  benchmarkId: string;
  ownerId: string;
}

export class GetBenchmarkAnalysisUseCase {
  constructor(
    private readonly benchmarks: IBenchmarkRepository,
    private readonly results: IBenchmarkResultRepository,
    private readonly analyzer: BenchmarkAnalyzer,
  ) {}

  async execute(command: GetBenchmarkAnalysisCommand): Promise<BenchmarkAnalysis> {
    const benchmark = await ensureBenchmarkAccess(
      this.benchmarks,
      command.benchmarkId,
      command.ownerId,
    );
    const results = await this.results.listByBenchmark(benchmark.id);
    const versionLabels = Object.fromEntries(
      benchmark.promptVersionIds.map((id, i) => [id, `v${i + 1}`]),
    );
    const testCasesById = Object.fromEntries(
      benchmark.testCases.map((tc) => [
        tc.id,
        { category: tc.category, source: tc.source },
      ]),
    );
    const commentaryModel = benchmark.analysisModel ?? benchmark.judgeModels[0];
    if (!commentaryModel) {
      throw new Error("Benchmark has no analysis or judge model configured");
    }
    return this.analyzer.analyze(results, testCasesById, versionLabels, commentaryModel);
  }
}
