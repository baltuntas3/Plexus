import type { Types } from "mongoose";
import type { TaskType } from "@plexus/shared-types";
import type {
  BenchmarkSummary,
  BenchmarkSummaryListResult,
  IBenchmarkQueryService,
  ListBenchmarkSummariesQuery,
} from "../../../application/queries/benchmark-query-service.js";
import type {
  BenchmarkProgress,
  BenchmarkStatus,
  TestGenerationMode,
} from "../../../domain/entities/benchmark.js";
import type { BenchmarkCostForecast } from "../../../domain/value-objects/benchmark-cost-forecast.js";
import { BenchmarkModel } from "./benchmark-model.js";

interface BenchmarkSummaryDoc {
  _id: Types.ObjectId;
  name: string;
  organizationId: Types.ObjectId;
  creatorId: Types.ObjectId;
  promptVersionIds: Types.ObjectId[];
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

const toSummary = (doc: BenchmarkSummaryDoc): BenchmarkSummary => ({
  id: String(doc._id),
  name: doc.name,
  organizationId: String(doc.organizationId),
  creatorId: String(doc.creatorId),
  promptVersionIds: doc.promptVersionIds.map((x) => String(x)),
  solverModels: doc.solverModels,
  judgeModels: doc.judgeModels,
  generatorModel: doc.generatorModel,
  testGenerationMode: doc.testGenerationMode ?? "shared-core",
  analysisModel: doc.analysisModel ?? null,
  taskType: doc.taskType ?? "general",
  costForecast: doc.costForecast ?? null,
  testCount: doc.testCount,
  repetitions: doc.repetitions,
  solverTemperature: doc.solverTemperature,
  seed: doc.seed,
  concurrency: doc.concurrency,
  cellTimeoutMs: doc.cellTimeoutMs ?? null,
  budgetUsd: doc.budgetUsd ?? null,
  status: doc.status,
  progress: { completed: doc.progress.completed, total: doc.progress.total },
  jobId: doc.jobId,
  error: doc.error,
  createdAt: doc.createdAt,
  startedAt: doc.startedAt,
  completedAt: doc.completedAt,
});

// Read-only projection for list endpoints. Hits the same collection as the
// write repository but excludes the heavy `testCases` array so pagination
// stays cheap no matter how many test cases a benchmark accumulates.
export class MongoBenchmarkQueryService implements IBenchmarkQueryService {
  async listBenchmarkSummaries(
    query: ListBenchmarkSummariesQuery,
  ): Promise<BenchmarkSummaryListResult> {
    const filter = { organizationId: query.organizationId };
    const skip = (query.page - 1) * query.pageSize;
    const [docs, total] = await Promise.all([
      BenchmarkModel.find(filter, { testCases: 0 })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(query.pageSize)
        .lean<BenchmarkSummaryDoc[]>(),
      BenchmarkModel.countDocuments(filter),
    ]);
    return { items: docs.map(toSummary), total };
  }
}
