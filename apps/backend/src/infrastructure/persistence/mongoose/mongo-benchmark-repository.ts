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

interface BenchmarkDocShape {
  _id: Types.ObjectId;
  name: string;
  ownerId: Types.ObjectId;
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
  ownerId: String(doc.ownerId),
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

  async save(benchmark: Benchmark): Promise<void> {
    const snapshot = benchmark.toSnapshot();
    const { state, expectedRevision, nextRevision } = snapshot;

    if (expectedRevision === 0) {
      try {
        await BenchmarkModel.create({
          _id: state.id,
          name: state.name,
          ownerId: state.ownerId,
          promptVersionIds: state.promptVersionIds,
          solverModels: state.solverModels,
          judgeModels: state.judgeModels,
          generatorModel: state.generatorModel,
          testGenerationMode: state.testGenerationMode,
          analysisModel: state.analysisModel,
          taskType: state.taskType,
          costForecast: state.costForecast,
          testCount: state.testCount,
          repetitions: state.repetitions,
          solverTemperature: state.solverTemperature,
          seed: state.seed,
          testCases: state.testCases,
          concurrency: state.concurrency,
          cellTimeoutMs: state.cellTimeoutMs,
          budgetUsd: state.budgetUsd,
          status: state.status,
          progress: state.progress,
          jobId: state.jobId,
          error: state.error,
          revision: nextRevision,
          createdAt: state.createdAt,
          startedAt: state.startedAt,
          completedAt: state.completedAt,
        });
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          throw BenchmarkAggregateStaleError();
        }
        throw err;
      }
    } else {
      const result = await BenchmarkModel.updateOne(
        { _id: state.id, revision: expectedRevision },
        {
          $set: {
            name: state.name,
            promptVersionIds: state.promptVersionIds,
            solverModels: state.solverModels,
            judgeModels: state.judgeModels,
            generatorModel: state.generatorModel,
            testGenerationMode: state.testGenerationMode,
            analysisModel: state.analysisModel,
            taskType: state.taskType,
            costForecast: state.costForecast,
            testCount: state.testCount,
            repetitions: state.repetitions,
            solverTemperature: state.solverTemperature,
            seed: state.seed,
            testCases: state.testCases,
            concurrency: state.concurrency,
            cellTimeoutMs: state.cellTimeoutMs,
            budgetUsd: state.budgetUsd,
            status: state.status,
            progress: state.progress,
            jobId: state.jobId,
            error: state.error,
            revision: nextRevision,
            startedAt: state.startedAt,
            completedAt: state.completedAt,
          },
        },
      );
      if (result.matchedCount === 0) {
        throw BenchmarkAggregateStaleError();
      }
    }

    benchmark.commit(snapshot);
  }
}

const isDuplicateKeyError = (err: unknown): boolean => {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: number }).code === 11000
  );
};

