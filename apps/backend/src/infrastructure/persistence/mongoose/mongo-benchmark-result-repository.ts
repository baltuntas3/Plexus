import type { Types } from "mongoose";
import {
  benchmarkResultKey,
  type BenchmarkFailureKind,
  type BenchmarkResult,
  type BenchmarkResultStatus,
  type JudgeVote,
} from "../../../domain/entities/benchmark-result.js";
import type {
  IBenchmarkResultRepository,
  UpsertBenchmarkResultInput,
} from "../../../domain/repositories/benchmark-result-repository.js";
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
  input: string;
  candidateOutput: string;
  judgeAccuracy: number;
  judgeCoherence: number;
  judgeInstruction: number;
  judgeVotes: JudgeVote[];
  finalScore: number;
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
  input: doc.input,
  candidateOutput: doc.candidateOutput,
  judgeAccuracy: doc.judgeAccuracy,
  judgeCoherence: doc.judgeCoherence,
  judgeInstruction: doc.judgeInstruction,
  judgeVotes: (doc.judgeVotes ?? []).map((v) => ({ ...v })),
  finalScore: doc.finalScore,
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
  async upsert(input: UpsertBenchmarkResultInput): Promise<BenchmarkResult> {
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

  async findExistingKeys(benchmarkId: string): Promise<Set<string>> {
    const docs = await BenchmarkResultModel.find(
      { benchmarkId },
      { testCaseId: 1, promptVersionId: 1, solverModel: 1, runIndex: 1 },
    ).lean();
    const out = new Set<string>();
    for (const d of docs as Array<{
      testCaseId: string;
      promptVersionId: Types.ObjectId | string;
      solverModel: string;
      runIndex: number;
    }>) {
      out.add(
        benchmarkResultKey(
          d.testCaseId,
          String(d.promptVersionId),
          d.solverModel,
          d.runIndex,
        ),
      );
    }
    return out;
  }

}
