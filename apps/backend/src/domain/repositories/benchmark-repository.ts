import type { TaskType } from "@plexus/shared-types";
import type {
  Benchmark,
  BenchmarkCostForecast,
  BenchmarkProgress,
  BenchmarkStatus,
  BenchmarkTestCase,
} from "../entities/benchmark.js";

export interface CreateBenchmarkInput {
  name: string;
  ownerId: string;
  promptVersionIds: string[];
  solverModels: string[];
  judgeModels: string[];
  generatorModel: string;
  testGenerationMode: Benchmark["testGenerationMode"];
  analysisModel: string | null;
  taskType: TaskType;
  costForecast: BenchmarkCostForecast | null;
  testCount: number;
  repetitions: number;
  solverTemperature: number;
  seed: number;
  testCases: BenchmarkTestCase[];
  concurrency: number;
  cellTimeoutMs: number | null;
  budgetUsd: number | null;
}

export interface ListBenchmarksQuery {
  ownerId: string;
  page: number;
  pageSize: number;
}

export interface BenchmarkListResult {
  items: Benchmark[];
  total: number;
}

export interface BenchmarkStatusUpdate {
  status: BenchmarkStatus;
  jobId?: string | null;
  error?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
}

export interface IBenchmarkRepository {
  create(input: CreateBenchmarkInput): Promise<Benchmark>;
  findById(id: string): Promise<Benchmark | null>;
  list(query: ListBenchmarksQuery): Promise<BenchmarkListResult>;
  updateStatus(id: string, update: BenchmarkStatusUpdate): Promise<void>;
  updateProgress(id: string, progress: BenchmarkProgress): Promise<void>;
  updateTestCases(
    id: string,
    updates: Array<{
      id: string;
      input?: string;
      expectedOutput: string | null;
      category?: BenchmarkTestCase["category"];
    }>,
    additions: Array<{
      id: string;
      input: string;
      expectedOutput: string | null;
      category: BenchmarkTestCase["category"];
      source: BenchmarkTestCase["source"];
    }>,
  ): Promise<void>;
}
