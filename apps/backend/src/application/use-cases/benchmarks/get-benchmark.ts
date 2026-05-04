import type { Benchmark } from "../../../domain/entities/benchmark.js";
import type { BenchmarkResult } from "../../../domain/entities/benchmark-result.js";
import type { IBenchmarkRepository } from "../../../domain/repositories/benchmark-repository.js";
import type { IBenchmarkResultRepository } from "../../../domain/repositories/benchmark-result-repository.js";
import type { IPromptQueryService } from "../../queries/prompt-query-service.js";
import { ensureBenchmarkAccess } from "./ensure-benchmark-access.js";
import { buildVersionLabels } from "./get-benchmark-analysis.js";

interface GetBenchmarkCommand {
  benchmarkId: string;
  organizationId: string;
}

// Version labels travel alongside the benchmark so every UI surface —
// row tables, charts, ensemble judge report — renders the user's own
// naming (falling back to "v1"/"v2" only when a version has no name set
// yet).
interface GetBenchmarkResult {
  benchmark: Benchmark;
  results: BenchmarkResult[];
  versionLabels: Record<string, string>;
}

export class GetBenchmarkUseCase {
  constructor(
    private readonly benchmarks: IBenchmarkRepository,
    private readonly results: IBenchmarkResultRepository,
    private readonly promptQueries: IPromptQueryService,
  ) {}

  async execute(command: GetBenchmarkCommand): Promise<GetBenchmarkResult> {
    const benchmark = await ensureBenchmarkAccess(
      this.benchmarks,
      command.benchmarkId,
      command.organizationId,
    );
    const [results, versionLabels] = await Promise.all([
      this.results.listByBenchmark(benchmark.id),
      buildVersionLabels(
        this.promptQueries,
        [...benchmark.promptVersionIds],
        benchmark.organizationId,
      ),
    ]);
    return { benchmark, results, versionLabels };
  }
}
