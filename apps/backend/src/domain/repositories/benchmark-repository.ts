import type {
  Benchmark,
  BenchmarkProgress,
  BenchmarkStatus,
  BenchmarkTestCase,
} from "../entities/benchmark.js";

export interface CreateBenchmarkInput {
  name: string;
  ownerId: string;
  promptVersionIds: string[];
  solverModels: string[];
  judgeModel: string;
  generatorModel: string;
  testCount: number;
  testCases: BenchmarkTestCase[];
  concurrency: number;
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
    updates: Array<{ id: string; expectedOutput: string | null }>,
  ): Promise<void>;
}
