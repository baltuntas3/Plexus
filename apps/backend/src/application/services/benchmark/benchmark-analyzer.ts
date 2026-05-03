// Single unified analyzer for a benchmark run.
//
// Every candidate is (promptVersionId × solverModel). For each candidate the
// analyzer computes: rubric means across all graded rows, a consistency score
// from across-row variance, mean latency + cost, total cost, and a cluster
// bootstrap 95% confidence interval on `meanFinalScore` so two candidates
// can be compared as "significantly different vs. within noise".
//
// The analyzer then produces three ranked views:
//
//   1. Pareto frontier on (maximize meanFinalScore, minimize totalCostUsd) —
//      non-dominated candidates are highlighted in the UI.
//   2. PPD vs. a Pareto-eligible baseline (most expensive among candidates
//      clearing an 80% score floor), matching the paper's framing.
//   3. Composite ranking: quality (80%, geometric mean of normalised rubric
//      dimensions + consistency) plus efficiency (20%, min-max normalised
//      latency + cost). The composite is the recommended-selection rule,
//      because Pareto alone cannot break ties along the frontier and PPD
//      alone ignores consistency.
//
// Recommendation is the highest-composite candidate that also passes the
// score floor — so a cheap-but-terrible row never wins. If a runner-up is
// statistically inseparable from the top under paired bootstrap, the
// cheaper candidate wins. Quality aggregates only use completed rows;
// failed rows still contribute to latency/cost and reliability telemetry
// so provider/judge errors do not masquerade as "fast and free". The
// ensemble judge report attaches each candidate's representative judge
// reasoning quotes (per-judge top/bottom plus the row of maximum
// disagreement) so the UI can show real, attributed grader feedback
// without an extra LLM narration call.

import type {
  BenchmarkResult,
  JudgeVote,
} from "../../../domain/entities/benchmark-result.js";
import type { BenchmarkTestCase } from "../../../domain/entities/benchmark.js";
import { PPD } from "../../../domain/value-objects/ppd.js";
import { mean } from "../../utils/statistics.js";

const BOOTSTRAP_SAMPLES = 10_000;
const BOOTSTRAP_SEED = 0x9e3779b9;
const SCORE_FLOOR_FRACTION = 0.8;
// A candidate whose operational-issue rate exceeds this threshold is not
// eligible to be the recommendation — reliability is a precondition for
// "best", not a knob to trade against a high mean score.
const MAX_OPERATIONAL_ISSUE_RATE_FOR_RECOMMENDATION = 0.1;

// finalScore is in [0,1]; stddev 0.25 is the practical ceiling for real LLM
// benchmark runs (scores alternating near 0 and 1), so anything above it
// clamps to 0% consistency. Exposed as a default so stricter task families
// (e.g. deterministic math) can dial it down via AnalyzerOptions.
const DEFAULT_CONSISTENCY_STDDEV_CEILING = 0.4;

// Composite ranking weights. Quality (geometric mean across rubric + consistency)
// counts 80%, efficiency (latency + cost) 20% — split 10/10. The geometric-mean
// inner weights sum to 80/80 so consistency + rubric line up with the overall
// 80% quality share. Expressed as named constants here so the policy is
// greppable in one place and easy to adjust without hunting magic numbers.
const COMPOSITE_QUALITY_WEIGHT = 0.8;
const QUALITY_ACCURACY_FRACTION = 25 / 80;
const QUALITY_COHERENCE_FRACTION = 20 / 80;
const QUALITY_INSTRUCTION_FRACTION = 20 / 80;
const QUALITY_CONSISTENCY_FRACTION = 15 / 80;
const EFFICIENCY_LATENCY_WEIGHT = 0.1;
const EFFICIENCY_COST_WEIGHT = 0.1;
const SOFT_RELIABILITY_PENALTY_WEIGHT = 0.5;

export interface CandidateStats {
  candidateKey: string;
  promptVersionId: string;
  solverModel: string;
  meanAccuracy: number;
  meanCoherence: number;
  meanInstruction: number;
  meanFinalScore: number;
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

export interface PPDRow {
  candidateKey: string;
  ppd: number;
  isMoreEfficient: boolean;
}

export interface CompositeRanking {
  candidateKey: string;
  compositeScore: number;
}

export type CategoryKey = NonNullable<BenchmarkTestCase["category"]> | "manual" | "uncategorized";

export interface CategoryBreakdownRow {
  candidateKey: string;
  promptVersionId: string;
  solverModel: string;
  category: CategoryKey;
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

export interface JudgeAgreementRow {
  judgeModelA: string;
  judgeModelB: string;
  sharedVotes: number;
  meanAbsAccuracyDiff: number;
  meanAbsCoherenceDiff: number;
  meanAbsInstructionDiff: number;
  exactAgreementRate: number;
  agreementScore: number;
}

// Real, attributed judge feedback surfaced from `judgeVotes` on the result
// rows. Replaces the old single LLM-narrated commentary string: the judges
// already produced reasoning per row, so summarising their actual quotes is
// honest and free, while a separate narration LLM call would have to invent
// causality on top of the deterministic numbers.
export interface EnsembleJudgeQuote {
  testCaseId: string;
  runIndex: number;
  finalScore: number;
  rubric: { accuracy: number; coherence: number; instruction: number };
  reasoning: string;
}

export interface EnsembleJudgePerJudge {
  model: string;
  voteCount: number;
  meanAccuracy: number;
  meanCoherence: number;
  meanInstruction: number;
  // Highest- and lowest-scoring rows per this judge alone, so the UI can
  // show "judge X liked this row best, disliked this one most" with the
  // judge's own words. Null when the judge has no votes for the candidate.
  topRated: EnsembleJudgeQuote | null;
  bottomRated: EnsembleJudgeQuote | null;
}

export interface EnsembleJudgeDisagreement {
  testCaseId: string;
  runIndex: number;
  // Spread = max(judge mean rubric) − min(judge mean rubric) on the row.
  // Treats the per-row split between graders as the diagnostic, not the
  // absolute scores.
  spread: number;
  perJudge: Array<{
    model: string;
    accuracy: number;
    coherence: number;
    instruction: number;
    reasoning: string;
  }>;
}

export interface EnsembleJudgeCandidateReport {
  candidateKey: string;
  promptVersionId: string;
  solverModel: string;
  judges: EnsembleJudgePerJudge[];
  // The single completed row where graders disagreed most. Null when fewer
  // than two judges contributed votes to any row of the candidate.
  maxDisagreement: EnsembleJudgeDisagreement | null;
}

export interface EnsembleJudgeReport {
  perCandidate: EnsembleJudgeCandidateReport[];
}

export interface BenchmarkAnalysis {
  candidates: CandidateStats[];
  categoryBreakdown: CategoryBreakdownRow[];
  paretoFrontierKeys: string[];
  baselineKey: string | null;
  ppd: PPDRow[];
  ranking: CompositeRanking[];
  recommendedKey: string | null;
  recommendedReasoning: string;
  recommendationDecision: RecommendationDecision;
  judgeAgreement: JudgeAgreementRow[];
  ensembleJudgeReport: EnsembleJudgeReport;
}

export interface RecommendationDecision {
  mode: "top_composite" | "paired_cost_tie_break";
  topCompositeKey: string | null;
  selectedKey: string | null;
  comparedAgainstKey: string | null;
  pairedDiffCiLow: number | null;
  pairedDiffCiHigh: number | null;
}

export const candidateKey = (c: Pick<
  CandidateStats,
  "promptVersionId" | "solverModel"
>): string => `${c.promptVersionId}::${c.solverModel}`;

export const aggregateResults = (
  results: readonly BenchmarkResult[],
  consistencyStddevCeiling: number = DEFAULT_CONSISTENCY_STDDEV_CEILING,
): CandidateStats[] => {
  type Bucket = {
    promptVersionId: string;
    solverModel: string;
    finalScores: number[];
    // Reps grouped by testCaseId. The runner judges all reps of the same
    // (candidate, testCase) in a single batched LLM call, so per-rep noise
    // is correlated within these groups. The CI is computed via cluster
    // bootstrap over these groups so the resampling distribution preserves
    // that correlation; treating reps as i.i.d. would understate spread.
    scoresByTestCase: Map<string, number[]>;
    accuracies: number[];
    coherences: number[];
    instructions: number[];
    latencies: number[];
    costs: number[];
    totalCost: number;
    completedCount: number;
    failedCount: number;
    operationalIssueCount: number;
  };
  const buckets = new Map<string, Bucket>();

  for (const r of results) {
    const key = candidateKey(r);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        promptVersionId: r.promptVersionId,
        solverModel: r.solverModel,
        finalScores: [],
        scoresByTestCase: new Map(),
        accuracies: [],
        coherences: [],
        instructions: [],
        latencies: [],
        costs: [],
        totalCost: 0,
        completedCount: 0,
        failedCount: 0,
        operationalIssueCount: 0,
      };
      buckets.set(key, bucket);
    }

    if (r.status === "failed") {
      bucket.latencies.push(r.latencyMs);
      bucket.costs.push(r.totalCostUsd);
      bucket.totalCost += r.totalCostUsd;
      bucket.failedCount += 1;
      bucket.operationalIssueCount += operationalIssueWeight(r);
      continue;
    }

    bucket.finalScores.push(r.finalScore);
    const cluster = bucket.scoresByTestCase.get(r.testCaseId) ?? [];
    cluster.push(r.finalScore);
    bucket.scoresByTestCase.set(r.testCaseId, cluster);
    bucket.accuracies.push(r.judgeAccuracy);
    bucket.coherences.push(r.judgeCoherence);
    bucket.instructions.push(r.judgeInstruction);
    bucket.latencies.push(r.latencyMs);
    bucket.costs.push(r.totalCostUsd);
    bucket.totalCost += r.totalCostUsd;
    bucket.completedCount += 1;
    bucket.operationalIssueCount += operationalIssueWeight(r);
  }

  const rng = mulberry32(BOOTSTRAP_SEED);
  const out: CandidateStats[] = [];
  for (const [key, bucket] of buckets) {
    const completedCount = bucket.completedCount;
    const sd = stddev(bucket.finalScores);
    const ci = clusterBootstrapCI(
      [...bucket.scoresByTestCase.values()],
      rng,
    );
    const totalRows = completedCount + bucket.failedCount;
    out.push({
      candidateKey: key,
      promptVersionId: bucket.promptVersionId,
      solverModel: bucket.solverModel,
      meanAccuracy: mean(bucket.accuracies),
      meanCoherence: mean(bucket.coherences),
      meanInstruction: mean(bucket.instructions),
      meanFinalScore: mean(bucket.finalScores),
      ci95Low: ci.low,
      ci95High: ci.high,
      consistencyScore: consistencyFromStddev(sd, consistencyStddevCeiling),
      meanLatencyMs: mean(bucket.latencies),
      meanCostUsd: mean(bucket.costs),
      totalCostUsd: bucket.totalCost,
      completedCount,
      failedCount: bucket.failedCount,
      failureRate: totalRows === 0 ? 0 : bucket.failedCount / totalRows,
      operationalIssueCount: bucket.operationalIssueCount,
      operationalIssueRate:
        totalRows === 0 ? 0 : bucket.operationalIssueCount / totalRows,
    });
  }
  return out;
};

// Pareto frontier on (maximize meanFinalScore, minimize totalCostUsd).
export const computeParetoFrontier = (
  candidates: readonly CandidateStats[],
): CandidateStats[] => {
  const eligible = candidates.filter(isReliableForComparativeViews);
  return eligible.filter((c) => {
    return !eligible.some(
      (other) =>
        other !== c &&
        other.meanFinalScore >= c.meanFinalScore &&
        other.totalCostUsd <= c.totalCostUsd &&
        (other.meanFinalScore > c.meanFinalScore ||
          other.totalCostUsd < c.totalCostUsd),
    );
  });
};

const pickBaseline = (
  candidates: readonly CandidateStats[],
  scoreFloor: number,
): CandidateStats | null => {
  const eligible = candidates.filter(
    (c) => isReliableForComparativeViews(c) && c.meanFinalScore >= scoreFloor,
  );
  if (eligible.length === 0) {
    const best = candidates
      .filter(isReliableForComparativeViews)
      .sort((a, b) => b.meanFinalScore - a.meanFinalScore)[0];
    return best ?? null;
  }
  return eligible.sort((a, b) => b.totalCostUsd - a.totalCostUsd)[0] ?? null;
};

const computePPD = (
  candidates: readonly CandidateStats[],
  baseline: CandidateStats,
): PPDRow[] =>
  candidates
    .filter(isReliableForComparativeViews)
    .map((c) => {
      const score = PPD.compute(
        { accuracy: c.meanFinalScore, costUsd: c.totalCostUsd },
        { accuracy: baseline.meanFinalScore, costUsd: baseline.totalCostUsd },
      );
      return {
        candidateKey: c.candidateKey,
        ppd: score.value,
        isMoreEfficient: score.isMoreEfficient,
      };
    });

// Composite score: weighted combination of quality (geometric mean — penalises
// any dimension sitting at zero) and efficiency (additive — allows the worst
// latency/cost candidate to still contribute to quality-driven ranking),
// followed by a soft reliability penalty. The hard gate still excludes
// clearly unreliable candidates, but this soft penalty prevents a cliff where
// a candidate with modest operational issues remains entirely unpenalised
// until it crosses the eligibility threshold.
// Weights live in the module-level COMPOSITE_/QUALITY_/EFFICIENCY_ constants
// above so the policy is greppable in one place.
const computeCompositeRanking = (
  candidates: readonly CandidateStats[],
): CompositeRanking[] => {
  const eligible = candidates.filter(isReliableForComparativeViews);
  if (eligible.length === 0) return [];

  // Compute min/max once per dimension (was O(n²) per candidate before).
  const latencyRange = rangeOf(eligible, (c) => c.meanLatencyMs);
  const costRange = rangeOf(eligible, (c) => c.meanCostUsd);

  return eligible
    .map((c) => {
      const acc = normaliseRubricMean(c.meanAccuracy);
      const coh = normaliseRubricMean(c.meanCoherence);
      const ins = normaliseRubricMean(c.meanInstruction);
      const con = Math.max(0.1, c.consistencyScore);
      const quality =
        Math.pow(acc, QUALITY_ACCURACY_FRACTION) *
        Math.pow(coh, QUALITY_COHERENCE_FRACTION) *
        Math.pow(ins, QUALITY_INSTRUCTION_FRACTION) *
        Math.pow(con, QUALITY_CONSISTENCY_FRACTION);
      const efficiency =
        EFFICIENCY_LATENCY_WEIGHT *
          normaliseDescending(c.meanLatencyMs, latencyRange) +
        EFFICIENCY_COST_WEIGHT *
          normaliseDescending(c.meanCostUsd, costRange);
      const rawComposite = COMPOSITE_QUALITY_WEIGHT * quality + efficiency;
      const reliabilityMultiplier = Math.max(
        0,
        1 - c.operationalIssueRate * SOFT_RELIABILITY_PENALTY_WEIGHT,
      );
      const compositeScore = rawComposite * reliabilityMultiplier;
      return { candidateKey: c.candidateKey, compositeScore };
    })
    .sort((a, b) => b.compositeScore - a.compositeScore);
};

interface NumericRange {
  min: number;
  max: number;
}

const rangeOf = <T>(items: readonly T[], pick: (item: T) => number): NumericRange => {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const value = pick(item);
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 0 };
  }
  return { min, max };
};

// Maps `value` against `bestValue` robustly. The absolute lowest (best) value in range
// scores 1; as `value` grows against `bestValue`, the score falls harmonically.
// Using `bestValue / Math.max(bestValue, value)` is naturally bounded to [0,1]
// and entirely prevents single extreme outliers from compressing the scores of everybody else.
const normaliseDescending = (value: number, range: NumericRange): number => {
  const bestValue = range.min;
  if (value <= 0 || bestValue <= 0) return 1;
  return bestValue / Math.max(bestValue, value);
};

const normaliseRubricMean = (value: number): number => {
  const bounded = Math.max(0, Math.min(5, value));
  if (bounded < 1) return Math.max(0.01, bounded * 0.1);
  return 0.1 + ((bounded - 1) / 4) * 0.9;
};

const isReliableForComparativeViews = (candidate: CandidateStats): boolean =>
  candidate.completedCount > 0 &&
  candidate.operationalIssueRate <= MAX_OPERATIONAL_ISSUE_RATE_FOR_RECOMMENDATION;

const completedSampleKey = (
  row: Pick<BenchmarkResult, "testCaseId" | "runIndex">,
): string => `${row.testCaseId}::${row.runIndex}`;

const coverageSignature = (
  rows: readonly BenchmarkResult[],
): string =>
  rows
    .filter((row) => row.status === "completed")
    .map((row) => completedSampleKey(row))
    .sort()
    .join("|");

const pickComparableCoverageKeys = (
  candidates: readonly CandidateStats[],
  results: readonly BenchmarkResult[],
): Set<string> => {
  const reliableKeys = new Set(
    candidates
      .filter(isReliableForComparativeViews)
      .map((candidate) => candidate.candidateKey),
  );
  if (reliableKeys.size === 0) return new Set();

  const buckets = new Map<
    string,
    { candidateKeys: string[]; completedSamples: number }
  >();
  const rowsByCandidate = new Map<string, BenchmarkResult[]>();
  for (const row of results) {
    const key = candidateKey(row);
    rowsByCandidate.set(key, [...(rowsByCandidate.get(key) ?? []), row]);
  }

  for (const candidate of candidates) {
    if (!reliableKeys.has(candidate.candidateKey)) continue;
    const rows = rowsByCandidate.get(candidate.candidateKey) ?? [];
    const signature = coverageSignature(rows);
    const bucket = buckets.get(signature) ?? {
      candidateKeys: [],
      completedSamples: rows.filter((row) => row.status === "completed").length,
    };
    bucket.candidateKeys.push(candidate.candidateKey);
    buckets.set(signature, bucket);
  }

  const best = [...buckets.entries()]
    .sort((a, b) => {
      if (b[1].completedSamples !== a[1].completedSamples) {
        return b[1].completedSamples - a[1].completedSamples;
      }
      if (b[1].candidateKeys.length !== a[1].candidateKeys.length) {
        return b[1].candidateKeys.length - a[1].candidateKeys.length;
      }
      return a[0].localeCompare(b[0]);
    })[0];
  return new Set(best?.[1].candidateKeys ?? []);
};

export interface AnalyzerOptions {
  minScoreFraction?: number;
  // Override the stddev→consistency ceiling; lower values make the
  // consistency axis stricter. Omit to use DEFAULT_CONSISTENCY_STDDEV_CEILING.
  consistencyStddevCeiling?: number;
  testCasesById?: Record<
    string,
    Pick<BenchmarkTestCase, "category" | "source">
  >;
}

const categoryKeyForTestCase = (
  testCase: Pick<BenchmarkTestCase, "category" | "source"> | undefined,
): CategoryKey => {
  if (!testCase) return "uncategorized";
  if (testCase.category) return testCase.category;
  return testCase.source === "manual" ? "manual" : "uncategorized";
};

const aggregateCategoryBreakdown = (
  results: readonly BenchmarkResult[],
  testCasesById: Record<string, Pick<BenchmarkTestCase, "category" | "source">>,
): CategoryBreakdownRow[] => {
  type Bucket = {
    promptVersionId: string;
    solverModel: string;
    category: CategoryKey;
    finalScores: number[];
    accuracies: number[];
    coherences: number[];
    instructions: number[];
    latencies: number[];
    costs: number[];
    completedCount: number;
    failedCount: number;
    operationalIssueCount: number;
  };
  const buckets = new Map<string, Bucket>();

  for (const r of results) {
    const candidate = candidateKey(r);
    const category = categoryKeyForTestCase(testCasesById[r.testCaseId]);
    const key = `${candidate}::${category}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        promptVersionId: r.promptVersionId,
        solverModel: r.solverModel,
        category,
        finalScores: [],
        accuracies: [],
        coherences: [],
        instructions: [],
        latencies: [],
        costs: [],
        completedCount: 0,
        failedCount: 0,
        operationalIssueCount: 0,
      };
      buckets.set(key, bucket);
    }

    if (r.status === "failed") {
      bucket.latencies.push(r.latencyMs);
      bucket.costs.push(r.totalCostUsd);
      bucket.failedCount += 1;
      bucket.operationalIssueCount += operationalIssueWeight(r);
      continue;
    }

    bucket.finalScores.push(r.finalScore);
    bucket.accuracies.push(r.judgeAccuracy);
    bucket.coherences.push(r.judgeCoherence);
    bucket.instructions.push(r.judgeInstruction);
    bucket.latencies.push(r.latencyMs);
    bucket.costs.push(r.totalCostUsd);
    bucket.completedCount += 1;
    bucket.operationalIssueCount += operationalIssueWeight(r);
  }

  return [...buckets.entries()]
    .map(([key, bucket]) => {
      const completedCount = bucket.completedCount;
      const totalRows = completedCount + bucket.failedCount;
      return {
        candidateKey: key.slice(0, key.lastIndexOf("::")),
        promptVersionId: bucket.promptVersionId,
        solverModel: bucket.solverModel,
        category: bucket.category,
        meanFinalScore: mean(bucket.finalScores),
        meanAccuracy: mean(bucket.accuracies),
        meanCoherence: mean(bucket.coherences),
        meanInstruction: mean(bucket.instructions),
        meanLatencyMs: mean(bucket.latencies),
        meanCostUsd: mean(bucket.costs),
        completedCount,
        failedCount: bucket.failedCount,
        failureRate: totalRows === 0 ? 0 : bucket.failedCount / totalRows,
        operationalIssueCount: bucket.operationalIssueCount,
        operationalIssueRate:
          totalRows === 0 ? 0 : bucket.operationalIssueCount / totalRows,
      };
    })
    .sort((a, b) => {
      if (a.category === b.category) {
        return a.candidateKey.localeCompare(b.candidateKey);
      }
      return String(a.category).localeCompare(String(b.category));
    });
};

const computeJudgeAgreement = (
  results: readonly BenchmarkResult[],
): JudgeAgreementRow[] => {
  type AgreementBucket = {
    count: number;
    absAccuracyDiffs: number[];
    absCoherenceDiffs: number[];
    absInstructionDiffs: number[];
    exactAgreements: number;
  };

  const agreementBuckets = new Map<string, AgreementBucket>();

  for (const row of results) {
    if (row.status !== "completed" || row.judgeVotes.length < 2) continue;
    for (let i = 0; i < row.judgeVotes.length; i += 1) {
      for (let j = i + 1; j < row.judgeVotes.length; j += 1) {
        const left = row.judgeVotes[i]!;
        const right = row.judgeVotes[j]!;
        const [judgeModelA, judgeModelB] = [left.model, right.model].sort();
        const key = `${judgeModelA}::${judgeModelB}`;
        const bucket = agreementBuckets.get(key) ?? {
          count: 0,
          absAccuracyDiffs: [],
          absCoherenceDiffs: [],
          absInstructionDiffs: [],
          exactAgreements: 0,
        };
        bucket.count += 1;
        bucket.absAccuracyDiffs.push(Math.abs(left.accuracy - right.accuracy));
        bucket.absCoherenceDiffs.push(Math.abs(left.coherence - right.coherence));
        bucket.absInstructionDiffs.push(Math.abs(left.instruction - right.instruction));
        if (
          left.accuracy === right.accuracy &&
          left.coherence === right.coherence &&
          left.instruction === right.instruction
        ) {
          bucket.exactAgreements += 1;
        }
        agreementBuckets.set(key, bucket);
      }
    }
  }

  return [...agreementBuckets.entries()]
    .map(([key, bucket]) => {
      const [judgeModelA = "", judgeModelB = ""] = key.split("::");
      const meanAbsAccuracyDiff = mean(bucket.absAccuracyDiffs);
      const meanAbsCoherenceDiff = mean(bucket.absCoherenceDiffs);
      const meanAbsInstructionDiff = mean(bucket.absInstructionDiffs);
      const averageAbsDiff = mean([
        meanAbsAccuracyDiff,
        meanAbsCoherenceDiff,
        meanAbsInstructionDiff,
      ]);
      return {
        judgeModelA,
        judgeModelB,
        sharedVotes: bucket.count,
        meanAbsAccuracyDiff,
        meanAbsCoherenceDiff,
        meanAbsInstructionDiff,
        exactAgreementRate: bucket.count === 0 ? 0 : bucket.exactAgreements / bucket.count,
        agreementScore: Math.max(0, 1 - averageAbsDiff / 4),
      };
    })
    .sort((a, b) => b.agreementScore - a.agreementScore);
};

export const computeAnalysis = (
  results: readonly BenchmarkResult[],
  options: AnalyzerOptions = {},
): BenchmarkAnalysis => {
  const candidates = aggregateResults(
    results,
    options.consistencyStddevCeiling ?? DEFAULT_CONSISTENCY_STDDEV_CEILING,
  );
  const categoryBreakdown = aggregateCategoryBreakdown(
    results,
    options.testCasesById ?? {},
  );
  const comparableCoverageKeys = pickComparableCoverageKeys(candidates, results);
  const comparableCandidates = candidates.filter((candidate) =>
    comparableCoverageKeys.has(candidate.candidateKey),
  );
  const paretoFrontierKeys = computeParetoFrontier(comparableCandidates).map((c) => c.candidateKey);

  const completed = candidates.filter((c) => c.completedCount > 0);
  if (completed.length === 0) {
    return {
      candidates,
      categoryBreakdown,
      paretoFrontierKeys,
      baselineKey: null,
      ppd: [],
      ranking: [],
      recommendedKey: null,
      recommendedReasoning: "",
      recommendationDecision: {
        mode: "top_composite",
        topCompositeKey: null,
        selectedKey: null,
        comparedAgainstKey: null,
        pairedDiffCiLow: null,
        pairedDiffCiHigh: null,
      },
      judgeAgreement: [],
      ensembleJudgeReport: { perCandidate: [] },
    };
  }

  const reliableCompleted = completed.filter(isReliableForComparativeViews);
  const scoreFloorPool = reliableCompleted.length > 0 ? reliableCompleted : completed;
  const bestScore = Math.max(...scoreFloorPool.map((c) => c.meanFinalScore));
  const fraction = options.minScoreFraction ?? SCORE_FLOOR_FRACTION;
  const scoreFloor = bestScore * fraction;

  const baseline = pickBaseline(comparableCandidates, scoreFloor);
  const baselineKey = baseline ? baseline.candidateKey : null;

  const ranking = computeCompositeRanking(comparableCandidates);
  // Recommendation order: (1) clear score floor, (2) operational issue rate
  // below threshold, (3) highest composite, (4) tie-break on CI overlap by
  // cheaper mean cost. Reliability remains a hard precondition for "best",
  // but the composite already applies a soft penalty below this threshold so
  // mildly less reliable candidates do not tie perfectly with clean ones.
  const eligibleKeys = new Set(
    comparableCandidates
      .filter(
        (c) =>
          c.meanFinalScore >= scoreFloor &&
          c.operationalIssueRate <= MAX_OPERATIONAL_ISSUE_RATE_FOR_RECOMMENDATION,
      )
      .map((c) => c.candidateKey),
  );
  const eligibleRanking = ranking.filter((r) => eligibleKeys.has(r.candidateKey));
  const hasCoverageMismatch =
    comparableCoverageKeys.size > 0 &&
    comparableCoverageKeys.size !== reliableCompleted.length;
  const recommended = hasCoverageMismatch
    ? null
    : pickWithPairedSignificanceTieBreak(
        eligibleRanking,
        reliableCompleted.filter((candidate) => comparableCoverageKeys.has(candidate.candidateKey)),
        results,
      );
  const recommendedKey = recommended?.rank.candidateKey ?? null;
  const recommendedStats = recommendedKey
    ? reliableCompleted.find((c) => c.candidateKey === recommendedKey) ?? null
    : null;

  const ppd =
    baseline && baseline.totalCostUsd > 0 && baseline.meanFinalScore > 0
      ? computePPD(comparableCandidates, baseline)
      : [];

  return {
    candidates,
    categoryBreakdown,
    paretoFrontierKeys,
    baselineKey,
    ppd,
    ranking,
    recommendedKey,
    recommendedReasoning: recommendedStats
      ? buildRecommendationReasoning(recommendedStats, recommended?.rank.compositeScore ?? 0)
      : "",
    recommendationDecision: recommended
      ? {
          mode: recommended.mode,
          topCompositeKey: recommended.topCompositeKey,
          selectedKey: recommended.rank.candidateKey,
          comparedAgainstKey: recommended.comparedAgainstKey,
          pairedDiffCiLow: recommended.pairedDiffCi?.low ?? null,
          pairedDiffCiHigh: recommended.pairedDiffCi?.high ?? null,
        }
      : {
          mode: "top_composite",
          topCompositeKey: hasCoverageMismatch ? null : eligibleRanking[0]?.candidateKey ?? null,
          selectedKey: null,
          comparedAgainstKey: null,
          pairedDiffCiLow: null,
          pairedDiffCiHigh: null,
        },
    judgeAgreement: computeJudgeAgreement(results),
    ensembleJudgeReport: buildEnsembleJudgeReport(candidates, results),
  };
};

const overallJudgeMean = (vote: JudgeVote): number =>
  (vote.accuracy + vote.coherence + vote.instruction) / 3;

const buildQuoteFromVote = (
  row: BenchmarkResult,
  vote: JudgeVote,
): EnsembleJudgeQuote => ({
  testCaseId: row.testCaseId,
  runIndex: row.runIndex,
  finalScore: row.finalScore,
  rubric: {
    accuracy: vote.accuracy,
    coherence: vote.coherence,
    instruction: vote.instruction,
  },
  reasoning: vote.reasoning,
});

// Builds a per-candidate report of representative judge reasoning from the
// `judgeVotes` already persisted on each row. No LLM call: every quote is
// the verbatim text the judge produced during grading. Only completed rows
// with at least one vote contribute; failed rows are surfaced through the
// reliability axis instead.
const buildEnsembleJudgeReport = (
  candidates: readonly CandidateStats[],
  results: readonly BenchmarkResult[],
): EnsembleJudgeReport => {
  const rowsByCandidate = new Map<string, BenchmarkResult[]>();
  for (const row of results) {
    if (row.status !== "completed" || row.judgeVotes.length === 0) continue;
    const key = candidateKey(row);
    rowsByCandidate.set(key, [...(rowsByCandidate.get(key) ?? []), row]);
  }

  const perCandidate: EnsembleJudgeCandidateReport[] = [];
  for (const candidate of candidates) {
    if (candidate.completedCount === 0) continue;
    const rows = rowsByCandidate.get(candidate.candidateKey) ?? [];
    if (rows.length === 0) continue;

    const judgeBuckets = new Map<
      string,
      {
        votes: Array<{ row: BenchmarkResult; vote: JudgeVote }>;
        accuracies: number[];
        coherences: number[];
        instructions: number[];
      }
    >();
    for (const row of rows) {
      for (const vote of row.judgeVotes) {
        const bucket = judgeBuckets.get(vote.model) ?? {
          votes: [],
          accuracies: [],
          coherences: [],
          instructions: [],
        };
        bucket.votes.push({ row, vote });
        bucket.accuracies.push(vote.accuracy);
        bucket.coherences.push(vote.coherence);
        bucket.instructions.push(vote.instruction);
        judgeBuckets.set(vote.model, bucket);
      }
    }

    const judges: EnsembleJudgePerJudge[] = [...judgeBuckets.entries()]
      .map(([model, bucket]) => {
        // Stable tie-break by (testCaseId, runIndex) so two votes with the
        // same overall mean always pick the same row across reruns.
        const sorted = [...bucket.votes].sort((a, b) => {
          const diff = overallJudgeMean(b.vote) - overallJudgeMean(a.vote);
          if (diff !== 0) return diff;
          if (a.row.testCaseId !== b.row.testCaseId) {
            return a.row.testCaseId.localeCompare(b.row.testCaseId);
          }
          return a.row.runIndex - b.row.runIndex;
        });
        const top = sorted[0];
        const bottom = sorted[sorted.length - 1];
        return {
          model,
          voteCount: bucket.votes.length,
          meanAccuracy: mean(bucket.accuracies),
          meanCoherence: mean(bucket.coherences),
          meanInstruction: mean(bucket.instructions),
          topRated: top ? buildQuoteFromVote(top.row, top.vote) : null,
          bottomRated:
            bottom && bottom !== top
              ? buildQuoteFromVote(bottom.row, bottom.vote)
              : null,
        };
      })
      .sort((a, b) => a.model.localeCompare(b.model));

    let maxDisagreement: EnsembleJudgeDisagreement | null = null;
    for (const row of rows) {
      if (row.judgeVotes.length < 2) continue;
      const overallScores = row.judgeVotes.map(overallJudgeMean);
      const spread = Math.max(...overallScores) - Math.min(...overallScores);
      if (
        !maxDisagreement ||
        spread > maxDisagreement.spread ||
        (spread === maxDisagreement.spread &&
          (row.testCaseId < maxDisagreement.testCaseId ||
            (row.testCaseId === maxDisagreement.testCaseId &&
              row.runIndex < maxDisagreement.runIndex)))
      ) {
        maxDisagreement = {
          testCaseId: row.testCaseId,
          runIndex: row.runIndex,
          spread,
          perJudge: [...row.judgeVotes]
            .sort((a, b) => a.model.localeCompare(b.model))
            .map((vote) => ({
              model: vote.model,
              accuracy: vote.accuracy,
              coherence: vote.coherence,
              instruction: vote.instruction,
              reasoning: vote.reasoning,
            })),
        };
      }
    }

    perCandidate.push({
      candidateKey: candidate.candidateKey,
      promptVersionId: candidate.promptVersionId,
      solverModel: candidate.solverModel,
      judges,
      maxDisagreement,
    });
  }

  perCandidate.sort((a, b) => a.candidateKey.localeCompare(b.candidateKey));
  return { perCandidate };
};

const resultSampleKey = (
  r: Pick<BenchmarkResult, "testCaseId" | "runIndex">,
): string => `${r.testCaseId}::${r.runIndex}`;

const pairedDifferenceCI = (
  leftRows: readonly BenchmarkResult[],
  rightRows: readonly BenchmarkResult[],
): { low: number; high: number } | null => {
  const left = new Map(leftRows.map((r) => [resultSampleKey(r), r] as const));
  const right = new Map(rightRows.map((r) => [resultSampleKey(r), r] as const));
  const sharedKeys = [...left.keys()].filter((key) => right.has(key)).sort();
  if (sharedKeys.length < 2) return null;

  // Bucket per-rep diffs by testCaseId. Both candidates' reps for a single
  // testCase are judged in independent batched LLM calls (one per
  // candidate's triple), but each side's reps are internally correlated
  // because they share a judge call. Cluster-bootstrapping on testCaseId
  // preserves that correlation in the diff distribution.
  const diffsByTestCase = new Map<string, number[]>();
  for (const key of sharedKeys) {
    const l = left.get(key);
    const r = right.get(key);
    if (!l || !r || l.status !== "completed" || r.status !== "completed") continue;
    const bucket = diffsByTestCase.get(l.testCaseId) ?? [];
    bucket.push(l.finalScore - r.finalScore);
    diffsByTestCase.set(l.testCaseId, bucket);
  }
  const totalDiffs = [...diffsByTestCase.values()].reduce(
    (sum, bucket) => sum + bucket.length,
    0,
  );
  if (totalDiffs < 2) return null;
  const rng = mulberry32(hashString(sharedKeys.join("|")));
  return clusterBootstrapCI([...diffsByTestCase.values()], rng);
};

// Pick the top-composite candidate; if a runner-up is not statistically
// separable from the top under paired bootstrap of per-cell score
// differences, prefer the cheaper candidate among those tied setups.
export const pickWithPairedSignificanceTieBreak = (
  ranking: readonly CompositeRanking[],
  completed: readonly CandidateStats[],
  results: readonly BenchmarkResult[],
): {
  rank: CompositeRanking;
  mode: "top_composite" | "paired_cost_tie_break";
  topCompositeKey: string;
  comparedAgainstKey: string | null;
  pairedDiffCi: { low: number; high: number } | null;
} | null => {
  if (ranking.length === 0) return null;
  const byKey = new Map(completed.map((c) => [c.candidateKey, c] as const));
  const rowsByCandidate = new Map<string, BenchmarkResult[]>();
  for (const row of results) {
    const key = candidateKey(row);
    rowsByCandidate.set(key, [...(rowsByCandidate.get(key) ?? []), row]);
  }
  const top = ranking[0];
  if (!top) return null;
  const topStats = byKey.get(top.candidateKey);
  if (!topStats) {
    return {
      rank: top,
      mode: "top_composite",
      topCompositeKey: top.candidateKey,
      comparedAgainstKey: null,
      pairedDiffCi: null,
    };
  }

  let best: { rank: CompositeRanking; stats: CandidateStats } = {
    rank: top,
    stats: topStats,
  };
  let decision: {
    mode: "top_composite" | "paired_cost_tie_break";
    comparedAgainstKey: string | null;
    pairedDiffCi: { low: number; high: number } | null;
  } = {
    mode: "top_composite",
    comparedAgainstKey: null,
    pairedDiffCi: null,
  };
  for (const other of ranking.slice(1)) {
    const otherStats = byKey.get(other.candidateKey);
    if (!otherStats) continue;
    const diffCi = pairedDifferenceCI(
      rowsByCandidate.get(top.candidateKey) ?? [],
      rowsByCandidate.get(other.candidateKey) ?? [],
    );
    const notSeparable = diffCi
      ? diffCi.low <= 0 && diffCi.high >= 0
      : otherStats.ci95Low <= topStats.ci95High &&
        otherStats.ci95High >= topStats.ci95Low;
    if (!notSeparable) continue;
    if (otherStats.meanCostUsd < best.stats.meanCostUsd) {
      best = { rank: other, stats: otherStats };
      decision = {
        mode: "paired_cost_tie_break",
        comparedAgainstKey: top.candidateKey,
        pairedDiffCi: diffCi,
      };
    }
  }
  return {
    rank: best.rank,
    mode: decision.mode,
    topCompositeKey: top.candidateKey,
    comparedAgainstKey: decision.comparedAgainstKey,
    pairedDiffCi: decision.pairedDiffCi,
  };
};

const buildRecommendationReasoning = (s: CandidateStats, composite: number): string =>
  `Composite score ${(composite * 100).toFixed(1)}% — ` +
  `Accuracy ${s.meanAccuracy.toFixed(2)}, ` +
  `Coherence ${s.meanCoherence.toFixed(2)}, ` +
  `Instruction ${s.meanInstruction.toFixed(2)}, ` +
  `Consistency ${(s.consistencyScore * 100).toFixed(1)}%, ` +
  `CI95 [${s.ci95Low.toFixed(3)}, ${s.ci95High.toFixed(3)}], ` +
  `Failure rate ${(s.failureRate * 100).toFixed(1)}%, ` +
  `Operational issues ${(s.operationalIssueRate * 100).toFixed(1)}%, ` +
  `Latency ${Math.round(s.meanLatencyMs)} ms, ` +
  `Cost $${s.meanCostUsd.toFixed(4)}/test.`;

const operationalIssueWeight = (row: BenchmarkResult): number => {
  if (row.status === "failed") {
    return row.failureKind === "budget_exceeded" ? 0 : 1;
  }
  const totalJudges = row.judgeVotes.length + row.judgeFailureCount;
  if (totalJudges <= 0) return 0;
  return row.judgeFailureCount / totalJudges;
};

// Helpers.

const stddev = (values: readonly number[]): number => {
  if (values.length < 2) return 0;
  const m = mean(values);
  const v = values.reduce((s, x) => s + (x - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
};

const consistencyFromStddev = (
  sd: number,
  ceiling: number = DEFAULT_CONSISTENCY_STDDEV_CEILING,
): number => {
  if (ceiling <= 0) return sd === 0 ? 1 : 0;
  return Math.max(0, Math.min(1, 1 - sd / ceiling));
};

// Cluster (block) bootstrap on the mean. `groups` are clusters of
// observations that share judging-session noise — typically one cluster
// per testCaseId, holding all reps that were graded in the same batched
// judge call. Resampling whole clusters with replacement preserves the
// intra-cluster correlation that an i.i.d. row-level bootstrap would
// erase, so the resulting CI is honest about how much information the
// reps actually carry. Reduces to standard bootstrap when every cluster
// has size 1 (i.e. repetitions == 1).
const clusterBootstrapCI = (
  groups: readonly (readonly number[])[],
  rng: () => number,
): { low: number; high: number } => {
  const nonEmpty = groups.filter((g) => g.length > 0);
  if (nonEmpty.length === 0) return { low: 0, high: 0 };
  if (nonEmpty.length === 1) {
    const only = nonEmpty[0] ?? [];
    if (only.length === 0) return { low: 0, high: 0 };
    if (only.length === 1) {
      const v = only[0] ?? 0;
      return { low: v, high: v };
    }
  }
  const samples: number[] = new Array(BOOTSTRAP_SAMPLES);
  for (let i = 0; i < BOOTSTRAP_SAMPLES; i += 1) {
    let sum = 0;
    let count = 0;
    for (let j = 0; j < nonEmpty.length; j += 1) {
      const idx = Math.floor(rng() * nonEmpty.length);
      const cluster = nonEmpty[idx] ?? [];
      for (const v of cluster) {
        sum += v;
        count += 1;
      }
    }
    samples[i] = count === 0 ? 0 : sum / count;
  }
  samples.sort((a, b) => a - b);
  const lowIdx = Math.floor(0.025 * BOOTSTRAP_SAMPLES);
  const highIdx = Math.ceil(0.975 * BOOTSTRAP_SAMPLES) - 1;
  return {
    low: samples[lowIdx] ?? 0,
    high: samples[Math.min(highIdx, BOOTSTRAP_SAMPLES - 1)] ?? 0,
  };
};

// Deterministic 32-bit RNG so two calls with the same inputs produce the same
// confidence interval — important because analyze() is read-only and should
// not return a different CI on each refresh.
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const hashString = (value: string): number => {
  let h = BOOTSTRAP_SEED >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h ^ value.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};
