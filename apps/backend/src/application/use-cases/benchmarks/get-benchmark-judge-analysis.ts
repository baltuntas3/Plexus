import type { IBenchmarkRepository } from "../../../domain/repositories/benchmark-repository.js";
import type { IBenchmarkResultRepository } from "../../../domain/repositories/benchmark-result-repository.js";
import type {
  BenchmarkJudgeAnalyzer,
  BenchmarkJudgeAnalysis,
} from "../../services/benchmark/benchmark-judge-analyzer.js";
import { ensureBenchmarkAccess } from "./ensure-benchmark-access.js";

export interface GetBenchmarkJudgeAnalysisCommand {
  benchmarkId: string;
  ownerId: string;
}

export class GetBenchmarkJudgeAnalysisUseCase {
  constructor(
    private readonly benchmarks: IBenchmarkRepository,
    private readonly results: IBenchmarkResultRepository,
    private readonly analyzer: BenchmarkJudgeAnalyzer,
  ) {}

  async execute(command: GetBenchmarkJudgeAnalysisCommand): Promise<BenchmarkJudgeAnalysis> {
    const benchmark = await ensureBenchmarkAccess(
      this.benchmarks,
      command.benchmarkId,
      command.ownerId,
    );
    const results = await this.results.listByBenchmark(benchmark.id);
    const versionLabels = Object.fromEntries(
      benchmark.promptVersionIds.map((id, i) => [id, `v${i + 1}`]),
    );
    return this.analyzer.analyze(results, versionLabels, benchmark.judgeModel);
  }
}
