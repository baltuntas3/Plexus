import type { Types } from "mongoose";
import type { TaskType } from "@plexus/shared-types";
import {
  Benchmark,
  type BenchmarkPrimitives,
  type BenchmarkProgress,
  type BenchmarkStatus,
  type TestGenerationMode,
  type TestCaseCategory,
  type TestCaseSource,
} from "../../../domain/entities/benchmark.js";
import type { BenchmarkCostForecast } from "../../../domain/value-objects/benchmark-cost-forecast.js";
import { BenchmarkAggregateStaleError } from "../../../domain/errors/domain-error.js";
import type { IBenchmarkRepository } from "../../../domain/repositories/benchmark-repository.js";
import { BenchmarkModel } from "./benchmark-model.js";
import { runOptimisticSave } from "./optimistic-save.js";

interface BenchmarkDocShape {
  _id: Types.ObjectId;
  name: string;
  organizationId: Types.ObjectId;
  creatorId: Types.ObjectId;
  promptVersionIds: Types.ObjectId[];
  solverModels: string[];
  judgeModels: string[];
  generatorModel: string;
  testGenerationMode: TestGenerationMode;
  taskType: TaskType;
  costForecast: BenchmarkCostForecast | null;
  testCount: number;
  repetitions: number;
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
  revision?: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

const toPrimitives = (doc: BenchmarkDocShape): BenchmarkPrimitives => ({
  id: String(doc._id),
  name: doc.name,
  organizationId: String(doc.organizationId),
  creatorId: String(doc.creatorId),
  promptVersionIds: doc.promptVersionIds.map((x) => String(x)),
  solverModels: doc.solverModels,
  judgeModels: doc.judgeModels,
  generatorModel: doc.generatorModel,
  testGenerationMode: doc.testGenerationMode ?? "shared-core",
  taskType: doc.taskType ?? "general",
  costForecast: doc.costForecast ?? null,
  testCount: doc.testCount,
  repetitions: doc.repetitions,
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
  // Pre-revision docs are treated as revision 0; the next save writes a
  // real counter and self-heals.
  revision: doc.revision ?? 0,
  createdAt: doc.createdAt,
  startedAt: doc.startedAt,
  completedAt: doc.completedAt,
});

// Persists a Benchmark aggregate with optimistic concurrency. The update is
// gated on the expected revision so concurrent writers (user edit vs. runner
// tick) surface as BenchmarkAggregateStaleError instead of silently stomping
// each other's changes.
export class MongoBenchmarkRepository implements IBenchmarkRepository {
  async findById(id: string): Promise<Benchmark | null> {
    const doc = await BenchmarkModel.findById(id).lean<BenchmarkDocShape>();
    if (!doc) return null;
    return Benchmark.hydrate(toPrimitives(doc));
  }

  async findInOrganization(
    id: string,
    organizationId: string,
  ): Promise<Benchmark | null> {
    // Composite filter: missing and foreign collapse to the same null so
    // existence is not leaked via 403 vs 404 to id-enumeration.
    const doc = await BenchmarkModel.findOne({
      _id: id,
      organizationId,
    }).lean<BenchmarkDocShape>();
    if (!doc) return null;
    return Benchmark.hydrate(toPrimitives(doc));
  }

  async save(benchmark: Benchmark): Promise<void> {
    await runOptimisticSave({
      aggregate: benchmark,
      model: BenchmarkModel,
      toCreateDoc: (p) => ({
        _id: p.id,
        name: p.name,
        organizationId: p.organizationId,
        creatorId: p.creatorId,
        promptVersionIds: p.promptVersionIds,
        solverModels: p.solverModels,
        judgeModels: p.judgeModels,
        generatorModel: p.generatorModel,
        testGenerationMode: p.testGenerationMode,
        taskType: p.taskType,
        costForecast: p.costForecast,
        testCount: p.testCount,
        repetitions: p.repetitions,
        seed: p.seed,
        testCases: p.testCases,
        concurrency: p.concurrency,
        cellTimeoutMs: p.cellTimeoutMs,
        budgetUsd: p.budgetUsd,
        status: p.status,
        progress: p.progress,
        jobId: p.jobId,
        error: p.error,
        revision: p.revision,
        createdAt: p.createdAt,
        startedAt: p.startedAt,
        completedAt: p.completedAt,
      }),
      toUpdateSet: (p) => ({
        name: p.name,
        promptVersionIds: p.promptVersionIds,
        solverModels: p.solverModels,
        judgeModels: p.judgeModels,
        generatorModel: p.generatorModel,
        testGenerationMode: p.testGenerationMode,
        taskType: p.taskType,
        costForecast: p.costForecast,
        testCount: p.testCount,
        repetitions: p.repetitions,
        seed: p.seed,
        testCases: p.testCases,
        concurrency: p.concurrency,
        cellTimeoutMs: p.cellTimeoutMs,
        budgetUsd: p.budgetUsd,
        status: p.status,
        progress: p.progress,
        jobId: p.jobId,
        error: p.error,
        revision: p.revision,
        startedAt: p.startedAt,
        completedAt: p.completedAt,
      }),
      staleError: () => BenchmarkAggregateStaleError(),
    });
  }
}

