import {
  computeAnalysis,
  type BenchmarkAnalysis,
} from "../../services/benchmark/benchmark-analyzer.js";
import type { IBenchmarkRepository } from "../../../domain/repositories/benchmark-repository.js";
import type { IBenchmarkResultRepository } from "../../../domain/repositories/benchmark-result-repository.js";
import type { IPromptQueryService } from "../../queries/prompt-query-service.js";
import { ensureBenchmarkAccess } from "./ensure-benchmark-access.js";

// Read-only analysis endpoint. The full analysis — per-candidate stats,
// Pareto frontier, PPD, ranking, recommendation, and the ensemble judge
// report (real per-judge reasoning quotes pulled from `judgeVotes`) — is
// recomputed from the persisted result rows on every call. The
// computation is pure-TS, cheap, and never triggers an LLM, so the
// analysis page can be re-rendered freely without spending tokens.

export interface GetBenchmarkAnalysisCommand {
  benchmarkId: string;
  organizationId: string;
}

export class GetBenchmarkAnalysisUseCase {
  constructor(
    private readonly benchmarks: IBenchmarkRepository,
    private readonly results: IBenchmarkResultRepository,
  ) {}

  async execute(command: GetBenchmarkAnalysisCommand): Promise<BenchmarkAnalysis> {
    const benchmark = await ensureBenchmarkAccess(
      this.benchmarks,
      command.benchmarkId,
      command.organizationId,
    );
    const results = await this.results.listByBenchmark(benchmark.id);
    const testCasesById = Object.fromEntries(
      benchmark.testCases.map((tc) => [
        tc.id,
        { category: tc.category, source: tc.source },
      ]),
    );
    return computeAnalysis(results, { testCasesById });
  }
}

// Version label projection used by other read paths (benchmark detail,
// HTTP responses). Lives here for historical reasons; consumers import
// from this module.
export const buildVersionLabels = async (
  queries: IPromptQueryService,
  ids: readonly string[],
  organizationId: string,
): Promise<Record<string, string>> => {
  const versions = await queries.findVersionSummariesByIdsInOrganization(
    ids,
    organizationId,
  );
  const labels: Record<string, string> = {};
  ids.forEach((id, i) => {
    const v = versions.get(id);
    labels[id] = v?.name?.trim() || v?.version || `v${i + 1}`;
  });
  return labels;
};
