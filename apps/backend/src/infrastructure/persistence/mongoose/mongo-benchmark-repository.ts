import type { HydratedDocument, Types } from "mongoose";
import type {
  Benchmark,
  BenchmarkProgress,
  BenchmarkStatus,
  BenchmarkTestCase,
  TestGenerationMode,
  TestCaseCategory,
  TestCaseSource,
} from "../../../domain/entities/benchmark.js";
import type {
  BenchmarkListResult,
  BenchmarkStatusUpdate,
  CreateBenchmarkInput,
  IBenchmarkRepository,
  ListBenchmarksQuery,
} from "../../../domain/repositories/benchmark-repository.js";
import { BenchmarkModel } from "./benchmark-model.js";

type BenchmarkDoc = HydratedDocument<{
  _id: Types.ObjectId;
  name: string;
  ownerId: Types.ObjectId;
  promptVersionIds: Types.ObjectId[];
  solverModels: string[];
  judgeModels: string[];
  generatorModel: string;
  testGenerationMode: TestGenerationMode;
  analysisModel: string | null;
  testCount: number;
  repetitions: number;
  solverTemperature: number;
  seed: number;
  testCases: Array<{
    id: string;
    input: string;
    expectedOutput: string | null;
    category: TestCaseCategory | null;
    source: TestCaseSource;
  }>;
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
}>;

const toDomain = (doc: BenchmarkDoc): Benchmark => ({
  id: String(doc._id),
  name: doc.name,
  ownerId: String(doc.ownerId),
  promptVersionIds: doc.promptVersionIds.map((x) => String(x)),
  solverModels: doc.solverModels,
  judgeModels: doc.judgeModels,
  generatorModel: doc.generatorModel,
  testGenerationMode: doc.testGenerationMode ?? "shared-core",
  analysisModel: doc.analysisModel ?? null,
  testCount: doc.testCount,
  repetitions: doc.repetitions,
  solverTemperature: doc.solverTemperature,
  seed: doc.seed,
  testCases: (doc.testCases ?? []).map((tc) => ({
    id: tc.id,
    input: tc.input,
    expectedOutput: tc.expectedOutput,
    category: tc.category ?? null,
    source: tc.source ?? "generated",
  })),
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

export class MongoBenchmarkRepository implements IBenchmarkRepository {
  async create(input: CreateBenchmarkInput): Promise<Benchmark> {
    const doc = await BenchmarkModel.create({
      name: input.name,
      ownerId: input.ownerId,
      promptVersionIds: input.promptVersionIds,
      solverModels: input.solverModels,
      judgeModels: input.judgeModels,
      generatorModel: input.generatorModel,
      testGenerationMode: input.testGenerationMode,
      analysisModel: input.analysisModel,
      testCount: input.testCount,
      repetitions: input.repetitions,
      solverTemperature: input.solverTemperature,
      seed: input.seed,
      testCases: input.testCases,
      concurrency: input.concurrency,
      cellTimeoutMs: input.cellTimeoutMs,
      budgetUsd: input.budgetUsd,
      status: "draft",
      progress: { completed: 0, total: 0 },
    });
    return toDomain(doc as unknown as BenchmarkDoc);
  }

  async findById(id: string): Promise<Benchmark | null> {
    const doc = await BenchmarkModel.findById(id);
    return doc ? toDomain(doc as unknown as BenchmarkDoc) : null;
  }

  async list(query: ListBenchmarksQuery): Promise<BenchmarkListResult> {
    const filter = { ownerId: query.ownerId };
    const skip = (query.page - 1) * query.pageSize;
    const [docs, total] = await Promise.all([
      BenchmarkModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(query.pageSize),
      BenchmarkModel.countDocuments(filter),
    ]);
    return {
      items: docs.map((d) => toDomain(d as unknown as BenchmarkDoc)),
      total,
    };
  }

  async updateStatus(id: string, update: BenchmarkStatusUpdate): Promise<void> {
    const set: Record<string, unknown> = { status: update.status };
    if (update.jobId !== undefined) set.jobId = update.jobId;
    if (update.error !== undefined) set.error = update.error;
    if (update.startedAt !== undefined) set.startedAt = update.startedAt;
    if (update.completedAt !== undefined) set.completedAt = update.completedAt;
    await BenchmarkModel.findByIdAndUpdate(id, { $set: set });
  }

  async updateProgress(id: string, progress: BenchmarkProgress): Promise<void> {
    await BenchmarkModel.findByIdAndUpdate(id, { $set: { progress } });
  }

  async updateTestCases(
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
  ): Promise<void> {
    const doc = await BenchmarkModel.findById(id);
    if (!doc) return;
    const bm = doc as unknown as BenchmarkDoc;
    for (const update of updates) {
      const tc = bm.testCases.find((t) => t.id === update.id);
      if (!tc) continue;
      if (update.input !== undefined) tc.input = update.input;
      tc.expectedOutput = update.expectedOutput;
      if (update.category !== undefined) tc.category = update.category;
    }
    for (const addition of additions) {
      bm.testCases.push(addition);
    }
    await doc.save();
  }
}
