import type { ISODateString, Paginated } from "./common.js";
import type { TaskType } from "./prompt.js";

export type BenchmarkStatus =
  | "draft"
  | "queued"
  | "running"
  | "completed"
  | "completed_with_budget_cap"
  | "failed";
export type BenchmarkResultStatus = "completed" | "failed";
export type BenchmarkFailureKind =
  | "budget_exceeded"
  | "timeout"
  | "solver_error"
  | "judge_error"
  | "unknown";

export interface BenchmarkProgressDto {
  completed: number;
  total: number;
}

// A benchmark runs each matrix cell (testCase × promptVersion × solverModel)
// `repetitions` times, and every result is graded by EVERY judge in
// `judgeModels`. Quality scores are the mean across judges; variance across
// runs produces the confidence interval used by the analyzer.
export interface BenchmarkDto {
  id: string;
  name: string;
  organizationId: string;
  creatorId: string;
  promptVersionIds: string[];
  solverModels: string[];
  judgeModels: string[];
  generatorModel: string;
  testGenerationMode: "shared-core" | "diff-seeking" | "hybrid";
  taskType: TaskType;
  costForecast: BenchmarkCostForecastDto | null;
  testCount: number;
  repetitions: number;
  seed: number;
  concurrency: number;
  cellTimeoutMs: number | null;
  budgetUsd: number | null;
  status: BenchmarkStatus;
  progress: BenchmarkProgressDto;
  jobId: string | null;
  error: string | null;
  createdAt: ISODateString;
  startedAt: ISODateString | null;
  completedAt: ISODateString | null;
}

export interface BenchmarkCostForecastDto {
  estimatedMatrixCells: number;
  estimatedCandidateInputTokens: number;
  estimatedCandidateOutputTokens: number;
  estimatedJudgeInputTokens: number;
  estimatedJudgeOutputTokens: number;
  estimatedCandidateCostUsd: number;
  estimatedJudgeCostUsd: number;
  estimatedTotalCostUsd: number;
}

// One vote from a single judge on a single cell run.
export interface JudgeVoteDto {
  model: string;
  accuracy: number;
  coherence: number;
  instruction: number;
  reasoning: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface BenchmarkResultDto {
  id: string;
  benchmarkId: string;
  testCaseId: string;
  promptVersionId: string;
  solverModel: string;
  runIndex: number;
  input: string;
  candidateOutput: string;
  // Mean across judges.
  judgeAccuracy: number;
  judgeCoherence: number;
  judgeInstruction: number;
  judgeVotes: JudgeVoteDto[];
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
  createdAt: ISODateString;
}

// Minimal public surface: the caller picks which versions to compare, which
// models to benchmark as solvers, and how many cases to generate. Judge
// ensemble, generator, generation mode, repetitions, seed, concurrency and
// solver temperature are derived server-side for fairness and
// reproducibility — solver temperature is fixed at 0 so two benchmarks of
// the same prompts/models stay directly comparable.
export interface CreateBenchmarkRequest {
  name: string;
  promptVersionIds: string[];
  solverModels: string[];
  testCount: number;
}

export type BenchmarkListResponse = Paginated<BenchmarkDto>;

export const TEST_CASE_CATEGORIES = [
  "typical",
  "complex",
  "ambiguous",
  "adversarial",
  "edge_case",
  "contradictory",
  "stress",
] as const;
export type TestCaseCategory = (typeof TEST_CASE_CATEGORIES)[number];
export type TestCaseSource = "generated" | "manual";

export interface BenchmarkTestCaseDto {
  id: string;
  input: string;
  expectedOutput: string | null;
  category: TestCaseCategory | null;
  source: TestCaseSource;
}

export interface UpdateTestCasesRequest {
  updates: Array<{
    id: string;
    input?: string;
    expectedOutput: string | null;
    category?: TestCaseCategory | null;
  }>;
  additions?: Array<{
    input: string;
    expectedOutput: string | null;
    category?: TestCaseCategory | null;
  }>;
}

export interface BenchmarkDetailDto extends BenchmarkDto {
  results: BenchmarkResultDto[];
  testCases: BenchmarkTestCaseDto[];
  // Label for each promptVersionId: the user-set name when present, the
  // auto-generated version string otherwise. UIs should key off this instead
  // of reconstructing "v1"/"v2" locally.
  versionLabels: Record<string, string>;
}

// Unified analysis: one pass produces per-candidate stats with bootstrap 95% CI,
// the Pareto frontier on (quality, cost), PPD vs. the strongest eligible
// baseline, and a composite score (quality + efficiency + consistency) for
// ranking. Recommendation is the candidate with the highest composite that
// also clears the Pareto-eligibility floor.
export interface CandidateStatsDto {
  candidateKey: string;
  promptVersionId: string;
  solverModel: string;
  meanAccuracy: number;
  meanCoherence: number;
  meanInstruction: number;
  meanFinalScore: number;
  // Bootstrap 95% CI on meanFinalScore across per-row samples.
  ci95Low: number;
  ci95High: number;
  consistencyScore: number;
  meanLatencyMs: number;
  meanCostUsd: number;
  totalCostUsd: number;
  completedCount: number;
  failedCount: number;
  failureRate: number;
  operationalIssueCount: number;
  operationalIssueRate: number;
}

export type BenchmarkCategoryKey = TestCaseCategory | "manual" | "uncategorized";

export interface CategoryBreakdownRowDto {
  candidateKey: string;
  promptVersionId: string;
  solverModel: string;
  category: BenchmarkCategoryKey;
  meanFinalScore: number;
  meanAccuracy: number;
  meanCoherence: number;
  meanInstruction: number;
  meanLatencyMs: number;
  meanCostUsd: number;
  completedCount: number;
  failedCount: number;
  failureRate: number;
  operationalIssueCount: number;
  operationalIssueRate: number;
}

export interface PPDRowDto {
  candidateKey: string;
  ppd: number;
  isMoreEfficient: boolean;
}

export interface CompositeRankingDto {
  candidateKey: string;
  compositeScore: number;
}

export interface RecommendationDecisionDto {
  mode: "top_composite" | "paired_cost_tie_break";
  topCompositeKey: string | null;
  selectedKey: string | null;
  comparedAgainstKey: string | null;
  pairedDiffCiLow: number | null;
  pairedDiffCiHigh: number | null;
}

export interface JudgeAgreementRowDto {
  judgeModelA: string;
  judgeModelB: string;
  sharedVotes: number;
  meanAbsAccuracyDiff: number;
  meanAbsCoherenceDiff: number;
  meanAbsInstructionDiff: number;
  exactAgreementRate: number;
  agreementScore: number;
}

// Real, attributed judge feedback pulled from each row's `judgeVotes`. This
// replaces the old single LLM-narrated `commentary` string: the judges
// already produced reasoning at grade time, so summarising their actual
// quotes is honest and free.
export interface EnsembleJudgeQuoteDto {
  testCaseId: string;
  runIndex: number;
  finalScore: number;
  rubric: { accuracy: number; coherence: number; instruction: number };
  reasoning: string;
}

export interface EnsembleJudgePerJudgeDto {
  model: string;
  voteCount: number;
  meanAccuracy: number;
  meanCoherence: number;
  meanInstruction: number;
  topRated: EnsembleJudgeQuoteDto | null;
  bottomRated: EnsembleJudgeQuoteDto | null;
}

export interface EnsembleJudgeDisagreementDto {
  testCaseId: string;
  runIndex: number;
  spread: number;
  perJudge: Array<{
    model: string;
    accuracy: number;
    coherence: number;
    instruction: number;
    reasoning: string;
  }>;
}

export interface EnsembleJudgeCandidateReportDto {
  candidateKey: string;
  promptVersionId: string;
  solverModel: string;
  judges: EnsembleJudgePerJudgeDto[];
  maxDisagreement: EnsembleJudgeDisagreementDto | null;
}

export interface EnsembleJudgeReportDto {
  perCandidate: EnsembleJudgeCandidateReportDto[];
}

export interface BenchmarkAnalysisDto {
  candidates: CandidateStatsDto[];
  categoryBreakdown: CategoryBreakdownRowDto[];
  paretoFrontierKeys: string[];
  baselineKey: string | null;
  ppd: PPDRowDto[];
  ranking: CompositeRankingDto[];
  recommendedKey: string | null;
  recommendedReasoning: string;
  recommendationDecision: RecommendationDecisionDto;
  judgeAgreement: JudgeAgreementRowDto[];
  ensembleJudgeReport: EnsembleJudgeReportDto;
}

// SSE progress event payload.
export interface BenchmarkProgressEvent {
  benchmarkId: string;
  status: BenchmarkStatus;
  progress: BenchmarkProgressDto;
}
