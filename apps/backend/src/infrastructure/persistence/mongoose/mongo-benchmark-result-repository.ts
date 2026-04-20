import type { HydratedDocument, Types } from "mongoose";
import {
  benchmarkResultKey,
  type BenchmarkResult,
  type BenchmarkResultStatus,
  type JudgeVote,
} from "../../../domain/entities/benchmark-result.js";
import type {
  IBenchmarkResultRepository,
  UpdateScoresInput,
  UpsertBenchmarkResultInput,
} from "../../../domain/repositories/benchmark-result-repository.js";
import { BenchmarkResultModel } from "./benchmark-result-model.js";

type BenchmarkResultDoc = HydratedDocument<{
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
  rawScore: number;
  verbosityPenalty: number;
  finalScore: number;
  exactMatch: boolean | null;
  fuzzyMatchScore: number | null;
  candidateInputTokens: number;
  candidateOutputTokens: number;
  candidateCostUsd: number;
  judgeInputTokens: number;
  judgeOutputTokens: number;
  judgeCostUsd: number;
  totalCostUsd: number;
  latencyMs: number;
  status: BenchmarkResultStatus;
  error: string | null;
  createdAt: Date;
}>;

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
  rawScore: doc.rawScore,
  verbosityPenalty: doc.verbosityPenalty,
  finalScore: doc.finalScore,
  exactMatch: doc.exactMatch ?? null,
  fuzzyMatchScore: doc.fuzzyMatchScore ?? null,
  candidateInputTokens: doc.candidateInputTokens,
  candidateOutputTokens: doc.candidateOutputTokens,
  candidateCostUsd: doc.candidateCostUsd,
  judgeInputTokens: doc.judgeInputTokens,
  judgeOutputTokens: doc.judgeOutputTokens,
  judgeCostUsd: doc.judgeCostUsd,
  totalCostUsd: doc.totalCostUsd,
  latencyMs: doc.latencyMs,
  status: doc.status,
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
    });
    return toDomain(doc as unknown as BenchmarkResultDoc);
  }

  async listByBenchmark(benchmarkId: string): Promise<BenchmarkResult[]> {
    const docs = await BenchmarkResultModel.find({ benchmarkId });
    return docs.map((d) => toDomain(d as unknown as BenchmarkResultDoc));
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

  async updateScores(input: UpdateScoresInput): Promise<void> {
    await BenchmarkResultModel.findByIdAndUpdate(input.id, {
      $set: {
        verbosityPenalty: input.verbosityPenalty,
        finalScore: input.finalScore,
      },
    });
  }
}
