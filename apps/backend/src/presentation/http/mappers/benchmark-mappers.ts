import type {
  BenchmarkAnalysisDto,
  BenchmarkDetailDto,
  BenchmarkDto,
  BenchmarkResultDto,
} from "@plexus/shared-types";
import type { Benchmark } from "../../../domain/entities/benchmark.js";
import type { BenchmarkResult } from "../../../domain/entities/benchmark-result.js";
import type { BenchmarkAnalysis } from "../../../application/services/benchmark/benchmark-analyzer.js";
import { candidateKey } from "../../../application/services/benchmark/benchmark-analyzer.js";

export const toBenchmarkDto = (bm: Benchmark): BenchmarkDto => ({
  id: bm.id,
  name: bm.name,
  ownerId: bm.ownerId,
  promptVersionIds: bm.promptVersionIds,
  solverModels: bm.solverModels,
  judgeModel: bm.judgeModel,
  generatorModel: bm.generatorModel,
  testCount: bm.testCount,
  concurrency: bm.concurrency,
  status: bm.status,
  progress: bm.progress,
  jobId: bm.jobId,
  error: bm.error,
  createdAt: bm.createdAt.toISOString(),
  startedAt: bm.startedAt ? bm.startedAt.toISOString() : null,
  completedAt: bm.completedAt ? bm.completedAt.toISOString() : null,
});

export const toBenchmarkResultDto = (r: BenchmarkResult): BenchmarkResultDto => ({
  id: r.id,
  benchmarkId: r.benchmarkId,
  testCaseId: r.testCaseId,
  promptVersionId: r.promptVersionId,
  solverModel: r.solverModel,
  input: r.input,
  candidateOutput: r.candidateOutput,
  judgeAccuracy: r.judgeAccuracy,
  judgeCoherence: r.judgeCoherence,
  judgeInstruction: r.judgeInstruction,
  judgeReasoning: r.judgeReasoning,
  rawScore: r.rawScore,
  verbosityPenalty: r.verbosityPenalty,
  finalScore: r.finalScore,
  candidateInputTokens: r.candidateInputTokens,
  candidateOutputTokens: r.candidateOutputTokens,
  candidateCostUsd: r.candidateCostUsd,
  judgeInputTokens: r.judgeInputTokens,
  judgeOutputTokens: r.judgeOutputTokens,
  judgeCostUsd: r.judgeCostUsd,
  totalCostUsd: r.totalCostUsd,
  latencyMs: r.latencyMs,
  status: r.status,
  error: r.error,
  createdAt: r.createdAt.toISOString(),
});

export const toBenchmarkAnalysisDto = (analysis: BenchmarkAnalysis): BenchmarkAnalysisDto => ({
  candidates: analysis.candidates.map((c) => ({
    promptVersionId: c.promptVersionId,
    solverModel: c.solverModel,
    meanFinalScore: c.meanFinalScore,
    totalCostUsd: c.totalCostUsd,
    completedCount: c.completedCount,
    failedCount: c.failedCount,
    candidateKey: candidateKey(c),
  })),
  paretoFrontierKeys: analysis.paretoFrontierKeys,
  baselineKey: analysis.baselineKey,
  ppd: analysis.ppd.map((r) => ({
    candidateKey: candidateKey(r.candidate),
    ppd: r.ppd,
    isMoreEfficient: r.isMoreEfficient,
  })),
  recommendedKey: analysis.recommendedKey,
});

export const toBenchmarkDetailDto = (
  bm: Benchmark,
  results: BenchmarkResult[],
): BenchmarkDetailDto => ({
  ...toBenchmarkDto(bm),
  results: results.map(toBenchmarkResultDto),
  testCases: bm.testCases.map((tc) => ({
    id: tc.id,
    input: tc.input,
    expectedOutput: tc.expectedOutput,
  })),
});
