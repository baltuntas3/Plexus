import type {
  BenchmarkSummary,
  BenchmarkSummaryListResult,
  IBenchmarkQueryService,
  ListBenchmarkSummariesQuery,
} from "../../application/queries/benchmark-query-service.js";
import type { Benchmark } from "../../domain/entities/benchmark.js";
import type { InMemoryBenchmarkRepository } from "./in-memory-benchmark-repository.js";

// Test fake for the query side. Pulls state out of the write-side repo so
// tests only need to seed data in one place; mirrors the Mongo layout where
// both sides read from the same collection.
export class InMemoryBenchmarkQueryService implements IBenchmarkQueryService {
  constructor(private readonly repo: InMemoryBenchmarkRepository) {}

  async listBenchmarkSummaries(
    query: ListBenchmarkSummariesQuery,
  ): Promise<BenchmarkSummaryListResult> {
    const all = this.repo
      .allForOrganization(query.organizationId)
      .filter((bm: Benchmark) =>
        query.promptVersionId
          ? bm.promptVersionIds.includes(query.promptVersionId)
          : true,
      )
      .sort((a: Benchmark, b: Benchmark) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (query.page - 1) * query.pageSize;
    const page = all.slice(start, start + query.pageSize);
    return { items: page.map(toSummary), total: all.length };
  }
}

const toSummary = (benchmark: Benchmark): BenchmarkSummary => ({
  id: benchmark.id,
  name: benchmark.name,
  organizationId: benchmark.organizationId,
  creatorId: benchmark.creatorId,
  promptVersionIds: [...benchmark.promptVersionIds],
  solverModels: [...benchmark.solverModels],
  judgeModels: [...benchmark.judgeModels],
  generatorModel: benchmark.generatorModel,
  testGenerationMode: benchmark.testGenerationMode,
  taskType: benchmark.taskType,
  costForecast: benchmark.costForecast,
  testCount: benchmark.testCount,
  repetitions: benchmark.repetitions,
  seed: benchmark.seed,
  concurrency: benchmark.concurrency,
  cellTimeoutMs: benchmark.cellTimeoutMs,
  budgetUsd: benchmark.budgetUsd,
  status: benchmark.status,
  progress: benchmark.progress,
  jobId: benchmark.jobId,
  error: benchmark.error,
  createdAt: benchmark.createdAt,
  startedAt: benchmark.startedAt,
  completedAt: benchmark.completedAt,
});
