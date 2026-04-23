import type { BenchmarkAnalysis } from "../../services/benchmark/benchmark-analyzer.js";
import type { BenchmarkAnalyzer } from "../../services/benchmark/benchmark-analyzer.js";
import type { IBenchmarkRepository } from "../../../domain/repositories/benchmark-repository.js";
import type { IBenchmarkResultRepository } from "../../../domain/repositories/benchmark-result-repository.js";
import type { IPromptQueryService } from "../../queries/prompt-query-service.js";
import { ensureBenchmarkAccess } from "./ensure-benchmark-access.js";

// Loads the raw rows for a benchmark and hands them to the unified analyzer.
// Commentary uses the benchmark's configured analysisModel if set, otherwise
// falls back to the first judge model. Analysis numbers are deterministic;
// only the commentary model is configurable.
//
// Version labels feed both the commentary and the UI row labels. Preference
// order: the version's user-set `name`, then its auto-generated `version`
// field (e.g. "v1"), then a positional fallback — so a comparison a user
// named "baseline" vs "with-safety" reads that way everywhere, not as
// anonymous "v1" / "v2".

export interface GetBenchmarkAnalysisCommand {
  benchmarkId: string;
  ownerId: string;
}

export class GetBenchmarkAnalysisUseCase {
  constructor(
    private readonly benchmarks: IBenchmarkRepository,
    private readonly results: IBenchmarkResultRepository,
    private readonly promptQueries: IPromptQueryService,
    private readonly analyzer: BenchmarkAnalyzer,
  ) {}

  async execute(command: GetBenchmarkAnalysisCommand): Promise<BenchmarkAnalysis> {
    const benchmark = await ensureBenchmarkAccess(
      this.benchmarks,
      command.benchmarkId,
      command.ownerId,
    );
    const results = await this.results.listByBenchmark(benchmark.id);
    const versionLabels = await buildVersionLabels(
      this.promptQueries,
      benchmark.promptVersionIds,
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

export const buildVersionLabels = async (
  queries: IPromptQueryService,
  ids: readonly string[],
): Promise<Record<string, string>> => {
  const versions = await queries.findVersionsByIds(ids);
  const labels: Record<string, string> = {};
  ids.forEach((id, i) => {
    const v = versions.get(id);
    labels[id] = v?.name?.trim() || v?.version || `v${i + 1}`;
  });
  return labels;
};
