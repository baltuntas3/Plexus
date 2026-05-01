import type { TaskType } from "@plexus/shared-types";
import type {
  BenchmarkProgress,
  BenchmarkStatus,
  TestGenerationMode,
} from "../../domain/entities/benchmark.js";
import type { BenchmarkCostForecast } from "../../domain/value-objects/benchmark-cost-forecast.js";

// Read-side contract for the Benchmark aggregate. Write paths go through
// `IBenchmarkRepository.save(aggregate)`; read paths go through here so list
// endpoints can serve a narrow projection (no testCases, no judgeVotes)
// without hydrating the full aggregate.
//
// The summary matches the public BenchmarkDto shape — the fat fields
// (testCases, judgeVotes, candidateOutputs) live on BenchmarkDetailDto and
// are only fetched through the aggregate repository.

export interface BenchmarkSummary {
  id: string;
  name: string;
  organizationId: string;
  creatorId: string;
  promptVersionIds: string[];
  solverModels: string[];
  judgeModels: string[];
  generatorModel: string;
  testGenerationMode: TestGenerationMode;
  analysisModel: string | null;
  taskType: TaskType;
  costForecast: BenchmarkCostForecast | null;
  testCount: number;
  repetitions: number;
  solverTemperature: number;
  seed: number;
  concurrency: number;
  cellTimeoutMs: number | null;
  budgetUsd: number | null;
  status: BenchmarkStatus;
  progress: BenchmarkProgress;
  jobId: string | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface ListBenchmarkSummariesQuery {
  organizationId: string;
  page: number;
  pageSize: number;
  // When set, only benchmarks whose `promptVersionIds` array contains this
  // id are returned. Implementations apply the filter alongside the org
  // scope so paging and totals reflect the filtered set, not the full org.
  promptVersionId?: string;
}

export interface BenchmarkSummaryListResult {
  items: BenchmarkSummary[];
  total: number;
}

export interface IBenchmarkQueryService {
  listBenchmarkSummaries(
    query: ListBenchmarkSummariesQuery,
  ): Promise<BenchmarkSummaryListResult>;
}
