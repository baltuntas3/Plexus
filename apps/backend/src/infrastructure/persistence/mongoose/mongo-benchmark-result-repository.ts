import type { Types } from "mongoose";
import type {
  BenchmarkFailureKind,
  BenchmarkResult,
  BenchmarkResultStatus,
  JudgeVote,
  UpsertableBenchmarkResult,
} from "../../../domain/entities/benchmark-result.js";
import type { IBenchmarkResultRepository } from "../../../domain/repositories/benchmark-result-repository.js";
import { BenchmarkResultModel } from "./benchmark-result-model.js";

// Plain shape for `.lean()` reads. Hydrated docs were a footgun: spreading a
// Mongoose subdoc only copies internal symbols (__parentArray, _doc, …), so
// `{ ...vote }` returned an empty-looking object and every JudgeVote came
// back with model/accuracy/… undefined. `.lean()` returns POJOs; spreads
// behave normally.
interface BenchmarkResultDoc {
  _id: Types.ObjectId;
  benchmarkId: Types.ObjectId;
  testCaseId: string;
  promptVersionId: Types.ObjectId;
  solverModel: string;
  runIndex: number;
  candidateOutput: string;
  judgeVotes: JudgeVote[];
  candidateInputTokens: number;
  candidateOutputTokens: number;
  candidateCostUsd: number;
  judgeInputTokens: number;
  judgeOutputTokens: number;
  judgeCostUsd: number;
  totalCostUsd: number;
  judgeFailureCount: number;
  latencyMs: number;
  status: BenchmarkResultStatus;
  failureKind: BenchmarkFailureKind | null;
  error: string | null;
  createdAt: Date;
}

const toDomain = (doc: BenchmarkResultDoc): BenchmarkResult => ({
  id: String(doc._id),
  benchmarkId: String(doc.benchmarkId),
  testCaseId: doc.testCaseId,
  promptVersionId: String(doc.promptVersionId),
  solverModel: doc.solverModel,
  runIndex: doc.runIndex,
  candidateOutput: doc.candidateOutput,
  judgeVotes: (doc.judgeVotes ?? []).map((v) => ({ ...v })),
  candidateInputTokens: doc.candidateInputTokens,
  candidateOutputTokens: doc.candidateOutputTokens,
  candidateCostUsd: doc.candidateCostUsd,
  judgeInputTokens: doc.judgeInputTokens,
  judgeOutputTokens: doc.judgeOutputTokens,
  judgeCostUsd: doc.judgeCostUsd,
  totalCostUsd: doc.totalCostUsd,
  judgeFailureCount: doc.judgeFailureCount ?? 0,
  latencyMs: doc.latencyMs,
  status: doc.status,
  failureKind: doc.failureKind ?? null,
  error: doc.error,
  createdAt: doc.createdAt,
});

export class MongoBenchmarkResultRepository implements IBenchmarkResultRepository {
  async upsert(input: UpsertableBenchmarkResult): Promise<BenchmarkResult> {
    const filter = {
      benchmarkId: input.benchmarkId,
      testCaseId: input.testCaseId,
      promptVersionId: input.promptVersionId,
      solverModel: input.solverModel,
      runIndex: input.runIndex,
    };
    const doc = await BenchmarkResultModel.findOneAndUpdate(filter, { $set: input }, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }).lean<BenchmarkResultDoc>();
    if (!doc) {
      throw new Error("findOneAndUpdate with upsert returned null");
    }
    return toDomain(doc);
  }

  async listByBenchmark(benchmarkId: string): Promise<BenchmarkResult[]> {
    const docs = await BenchmarkResultModel.find({ benchmarkId }).lean<BenchmarkResultDoc[]>();
    return docs.map((d) => toDomain(d));
  }
}
