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
import { isDuplicateKeyError } from "./mongo-errors.js";
import { BenchmarkModel } from "./benchmark-model.js";

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
  analysisModel: string | null;
  taskType: TaskType;
  costForecast: BenchmarkCostForecast | null;
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
  analysisModel: doc.analysisModel ?? null,
  taskType: doc.taskType ?? "general",
  costForecast: doc.costForecast ?? null,
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
    const { primitives, expectedRevision } = benchmark.toSnapshot();

    if (expectedRevision === 0) {
      try {
        await BenchmarkModel.create({
          _id: primitives.id,
          name: primitives.name,
          organizationId: primitives.organizationId,
          creatorId: primitives.creatorId,
          promptVersionIds: primitives.promptVersionIds,
          solverModels: primitives.solverModels,
          judgeModels: primitives.judgeModels,
          generatorModel: primitives.generatorModel,
          testGenerationMode: primitives.testGenerationMode,
          analysisModel: primitives.analysisModel,
          taskType: primitives.taskType,
          costForecast: primitives.costForecast,
          testCount: primitives.testCount,
          repetitions: primitives.repetitions,
          solverTemperature: primitives.solverTemperature,
          seed: primitives.seed,
          testCases: primitives.testCases,
          concurrency: primitives.concurrency,
          cellTimeoutMs: primitives.cellTimeoutMs,
          budgetUsd: primitives.budgetUsd,
          status: primitives.status,
          progress: primitives.progress,
          jobId: primitives.jobId,
          error: primitives.error,
          revision: primitives.revision,
          createdAt: primitives.createdAt,
          startedAt: primitives.startedAt,
          completedAt: primitives.completedAt,
        });
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          throw BenchmarkAggregateStaleError();
        }
        throw err;
      }
    } else {
      const result = await BenchmarkModel.updateOne(
        { _id: primitives.id, revision: expectedRevision },
        {
          $set: {
            name: primitives.name,
            promptVersionIds: primitives.promptVersionIds,
            solverModels: primitives.solverModels,
            judgeModels: primitives.judgeModels,
            generatorModel: primitives.generatorModel,
            testGenerationMode: primitives.testGenerationMode,
            analysisModel: primitives.analysisModel,
            taskType: primitives.taskType,
            costForecast: primitives.costForecast,
            testCount: primitives.testCount,
            repetitions: primitives.repetitions,
            solverTemperature: primitives.solverTemperature,
            seed: primitives.seed,
            testCases: primitives.testCases,
            concurrency: primitives.concurrency,
            cellTimeoutMs: primitives.cellTimeoutMs,
            budgetUsd: primitives.budgetUsd,
            status: primitives.status,
            progress: primitives.progress,
            jobId: primitives.jobId,
            error: primitives.error,
            revision: primitives.revision,
            startedAt: primitives.startedAt,
            completedAt: primitives.completedAt,
          },
        },
      );
      if (result.matchedCount === 0) {
        throw BenchmarkAggregateStaleError();
      }
    }

    benchmark.markPersisted();
  }
}

