import type {
  BenchmarkAnalysisDto,
  BenchmarkDetailDto,
  BenchmarkDto,
  BenchmarkResultDto,
} from "@plexus/shared-types";
import type {
  Benchmark,
  BenchmarkTestCase,
} from "../../../domain/entities/benchmark.js";
import {
  judgeRubricAggregate,
  type BenchmarkResult,
} from "../../../domain/entities/benchmark-result.js";
import type { BenchmarkAnalysis } from "../../../application/services/benchmark/benchmark-analyzer.js";
import type { BenchmarkSummary } from "../../../application/queries/benchmark-query-service.js";

// Duck-types over both the write-side aggregate and the read-side summary so
// the same controller response shape can come from either path.
type BenchmarkLike = Benchmark | BenchmarkSummary;

export const toBenchmarkDto = (bm: BenchmarkLike): BenchmarkDto => ({
  id: bm.id,
  name: bm.name,
  organizationId: bm.organizationId,
  creatorId: bm.creatorId,
  promptVersionIds: [...bm.promptVersionIds],
  solverModels: [...bm.solverModels],
  judgeModels: [...bm.judgeModels],
  generatorModel: bm.generatorModel,
  testGenerationMode: bm.testGenerationMode,
  taskType: bm.taskType,
  costForecast: bm.costForecast ? { ...bm.costForecast } : null,
  testCount: bm.testCount,
  repetitions: bm.repetitions,
  seed: bm.seed,
  concurrency: bm.concurrency,
  cellTimeoutMs: bm.cellTimeoutMs,
  budgetUsd: bm.budgetUsd,
  status: bm.status,
  progress: { ...bm.progress },
  jobId: bm.jobId,
  error: bm.error,
  createdAt: bm.createdAt.toISOString(),
  startedAt: bm.startedAt ? bm.startedAt.toISOString() : null,
  completedAt: bm.completedAt ? bm.completedAt.toISOString() : null,
});

// `input` and the rubric aggregates (`judgeAccuracy/Coherence/Instruction`,
// `finalScore`) are derived for the DTO rather than persisted on the row:
// `input` resolves through `testCaseId` and the rubric means come from
// `judgeVotes`. Frontend contract preserved; storage stays normalized.
const toBenchmarkResultDto = (
  r: BenchmarkResult,
  testCasesById: Record<string, Pick<BenchmarkTestCase, "input">>,
): BenchmarkResultDto => {
  const rubric = judgeRubricAggregate(r.judgeVotes);
  return {
    id: r.id,
    benchmarkId: r.benchmarkId,
    testCaseId: r.testCaseId,
    promptVersionId: r.promptVersionId,
    solverModel: r.solverModel,
    runIndex: r.runIndex,
    input: testCasesById[r.testCaseId]?.input ?? "",
    candidateOutput: r.candidateOutput,
    judgeAccuracy: rubric.accuracy,
    judgeCoherence: rubric.coherence,
    judgeInstruction: rubric.instruction,
    judgeVotes: r.judgeVotes.map((v) => ({ ...v })),
    finalScore: rubric.finalScore,
    candidateInputTokens: r.candidateInputTokens,
    candidateOutputTokens: r.candidateOutputTokens,
    candidateCostUsd: r.candidateCostUsd,
    judgeInputTokens: r.judgeInputTokens,
    judgeOutputTokens: r.judgeOutputTokens,
    judgeCostUsd: r.judgeCostUsd,
    totalCostUsd: r.totalCostUsd,
    judgeFailureCount: r.judgeFailureCount,
    solverLatencyMs: r.solverLatencyMs,
    status: r.status,
    failureKind: r.failureKind,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
  };
};

export const toBenchmarkAnalysisDto = (
  analysis: BenchmarkAnalysis,
): BenchmarkAnalysisDto => ({
  candidates: analysis.candidates.map((c) => ({
    candidateKey: c.candidateKey,
    promptVersionId: c.promptVersionId,
    solverModel: c.solverModel,
    meanAccuracy: c.meanAccuracy,
    meanCoherence: c.meanCoherence,
    meanInstruction: c.meanInstruction,
    meanFinalScore: c.meanFinalScore,
    ci95Low: c.ci95Low,
    ci95High: c.ci95High,
    consistencyScore: c.consistencyScore,
    meanSolverLatencyMs: c.meanSolverLatencyMs,
    meanCostUsd: c.meanCostUsd,
    totalCostUsd: c.totalCostUsd,
    completedCount: c.completedCount,
    failedCount: c.failedCount,
    failureRate: c.failureRate,
    operationalIssueCount: c.operationalIssueCount,
    operationalIssueRate: c.operationalIssueRate,
  })),
  categoryBreakdown: analysis.categoryBreakdown.map((row) => ({
    candidateKey: row.candidateKey,
    promptVersionId: row.promptVersionId,
    solverModel: row.solverModel,
    category: row.category,
    meanFinalScore: row.meanFinalScore,
    meanAccuracy: row.meanAccuracy,
    meanCoherence: row.meanCoherence,
    meanInstruction: row.meanInstruction,
    meanSolverLatencyMs: row.meanSolverLatencyMs,
    meanCostUsd: row.meanCostUsd,
    completedCount: row.completedCount,
    failedCount: row.failedCount,
    failureRate: row.failureRate,
    operationalIssueCount: row.operationalIssueCount,
    operationalIssueRate: row.operationalIssueRate,
  })),
  paretoFrontierKeys: analysis.paretoFrontierKeys,
  baselineKey: analysis.baselineKey,
  ppd: analysis.ppd.map((r) => ({
    candidateKey: r.candidateKey,
    ppd: r.ppd,
    isMoreEfficient: r.isMoreEfficient,
  })),
  ranking: analysis.ranking.map((r) => ({
    candidateKey: r.candidateKey,
    compositeScore: r.compositeScore,
  })),
  recommendedKey: analysis.recommendedKey,
  recommendedReasoning: analysis.recommendedReasoning,
  recommendationDecision: {
    mode: analysis.recommendationDecision.mode,
    topCompositeKey: analysis.recommendationDecision.topCompositeKey,
    selectedKey: analysis.recommendationDecision.selectedKey,
    comparedAgainstKey: analysis.recommendationDecision.comparedAgainstKey,
    pairedDiffCiLow: analysis.recommendationDecision.pairedDiffCiLow,
    pairedDiffCiHigh: analysis.recommendationDecision.pairedDiffCiHigh,
  },
  judgeAgreement: analysis.judgeAgreement.map((row) => ({
    judgeModelA: row.judgeModelA,
    judgeModelB: row.judgeModelB,
    sharedVotes: row.sharedVotes,
    meanAbsAccuracyDiff: row.meanAbsAccuracyDiff,
    meanAbsCoherenceDiff: row.meanAbsCoherenceDiff,
    meanAbsInstructionDiff: row.meanAbsInstructionDiff,
    exactAgreementRate: row.exactAgreementRate,
    agreementScore: row.agreementScore,
  })),
  ensembleJudgeReport: {
    perCandidate: analysis.ensembleJudgeReport.perCandidate.map((entry) => ({
      candidateKey: entry.candidateKey,
      promptVersionId: entry.promptVersionId,
      solverModel: entry.solverModel,
      judges: entry.judges.map((judge) => ({
        model: judge.model,
        voteCount: judge.voteCount,
        meanAccuracy: judge.meanAccuracy,
        meanCoherence: judge.meanCoherence,
        meanInstruction: judge.meanInstruction,
        topRated: judge.topRated
          ? {
              testCaseId: judge.topRated.testCaseId,
              runIndex: judge.topRated.runIndex,
              finalScore: judge.topRated.finalScore,
              rubric: { ...judge.topRated.rubric },
              reasoning: judge.topRated.reasoning,
            }
          : null,
        bottomRated: judge.bottomRated
          ? {
              testCaseId: judge.bottomRated.testCaseId,
              runIndex: judge.bottomRated.runIndex,
              finalScore: judge.bottomRated.finalScore,
              rubric: { ...judge.bottomRated.rubric },
              reasoning: judge.bottomRated.reasoning,
            }
          : null,
      })),
      maxDisagreement: entry.maxDisagreement
        ? {
            testCaseId: entry.maxDisagreement.testCaseId,
            runIndex: entry.maxDisagreement.runIndex,
            spread: entry.maxDisagreement.spread,
            perJudge: entry.maxDisagreement.perJudge.map((vote) => ({ ...vote })),
          }
        : null,
    })),
  },
});

export const toBenchmarkDetailDto = (
  bm: Benchmark,
  results: BenchmarkResult[],
  versionLabels: Record<string, string>,
): BenchmarkDetailDto => {
  const testCasesById: Record<string, BenchmarkTestCase> = {};
  for (const tc of bm.testCases) {
    testCasesById[tc.id] = tc;
  }
  return {
    ...toBenchmarkDto(bm),
    results: results.map((r) => toBenchmarkResultDto(r, testCasesById)),
    testCases: bm.testCases.map((tc) => ({
      id: tc.id,
      input: tc.input,
      expectedOutput: tc.expectedOutput,
      category: tc.category,
      source: tc.source,
    })),
    versionLabels,
  };
};
