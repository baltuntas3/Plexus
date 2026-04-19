// Single unified analyzer for a benchmark run.
//
// Every candidate is (promptVersionId × solverModel). For each candidate the
// analyzer computes: rubric means across all graded rows, a consistency score
// from across-row variance, mean latency + cost, total cost, and a bootstrap
// 95% confidence interval on `meanFinalScore` so two candidates can be
// compared as "significantly different vs. within noise".
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
// score floor — so a cheap-but-terrible row never wins. Failed rows are
// included in quality aggregates as zero-utility samples, and any observed
// latency/cost from failed executions is preserved so provider/judge errors do
// not masquerade as "fast and free". Commentary is an LLM pass that narrates
// the comparison; it never overrides the deterministic recommendation.

import type {
  BenchmarkResult,
} from "../../../domain/entities/benchmark-result.js";
import type { BenchmarkTestCase } from "../../../domain/entities/benchmark.js";
import { PPD } from "../../../domain/value-objects/ppd.js";
import type { IAIProviderFactory } from "../ai-provider.js";

const BOOTSTRAP_SAMPLES = 10_000;
const BOOTSTRAP_SEED = 0x9e3779b9;
const SCORE_FLOOR_FRACTION = 0.8;
// A candidate whose share of failed cells exceeds this rate is not eligible
// to be the recommendation — reliability is a precondition for "best", not a
// knob to trade against a high mean score.
const MAX_FAILURE_RATE_FOR_RECOMMENDATION = 0.1;

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
  stderr: number;
  consistencyScore: number;
  meanLatencyMs: number;
  meanCostUsd: number;
  totalCostUsd: number;
  completedCount: number;
  failedCount: number;
  failureRate: number;
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
}

export interface PairwiseComparison {
  candidateKeyA: string;
  candidateKeyB: string;
  meanDiff: number;
  ci95Low: number;
  ci95High: number;
  isSignificant: boolean;
  effectSize: number;
  effectLabel: "negligible" | "small" | "medium" | "large";
}

export interface VarianceDecomposition {
  totalVariance: number;
  withinRunVariance: number;
  acrossTestCaseVariance: number;
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
  pairwiseComparisons: PairwiseComparison[];
  varianceDecomposition: VarianceDecomposition;
  exclusionReasons: Record<string, string>;
  suggestedRepetitions: number;
  suggestedRepetitionsRationale: string;
  commentary: string;
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
    accuracies: number[];
    coherences: number[];
    instructions: number[];
    latencies: number[];
    costs: number[];
    totalCost: number;
    completedCount: number;
    failedCount: number;
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
        accuracies: [],
        coherences: [],
        instructions: [],
        latencies: [],
        costs: [],
        totalCost: 0,
        completedCount: 0,
        failedCount: 0,
      };
      buckets.set(key, bucket);
    }

    if (r.status === "failed") {
      bucket.finalScores.push(0);
      bucket.accuracies.push(0);
      bucket.coherences.push(0);
      bucket.instructions.push(0);
      bucket.latencies.push(r.latencyMs);
      bucket.costs.push(r.totalCostUsd);
      bucket.totalCost += r.totalCostUsd;
      bucket.failedCount += 1;
      continue;
    }

    bucket.finalScores.push(r.finalScore);
    bucket.accuracies.push(r.judgeAccuracy);
    bucket.coherences.push(r.judgeCoherence);
    bucket.instructions.push(r.judgeInstruction);
    bucket.latencies.push(r.latencyMs);
    bucket.costs.push(r.totalCostUsd);
    bucket.totalCost += r.totalCostUsd;
    bucket.completedCount += 1;
  }

  const rng = mulberry32(BOOTSTRAP_SEED);
  const out: CandidateStats[] = [];
  for (const [key, bucket] of buckets) {
    const sampleCount = bucket.finalScores.length;
    const completedCount = bucket.completedCount;
    const m = mean(bucket.finalScores);
    const sd = stddev(bucket.finalScores);
    const ci = bootstrapCI(bucket.finalScores, rng);
    const totalRows = completedCount + bucket.failedCount;
    out.push({
      candidateKey: key,
      promptVersionId: bucket.promptVersionId,
      solverModel: bucket.solverModel,
      meanAccuracy: mean(bucket.accuracies),
      meanCoherence: mean(bucket.coherences),
      meanInstruction: mean(bucket.instructions),
      meanFinalScore: m,
      ci95Low: ci.low,
      ci95High: ci.high,
      stderr: sampleCount === 0 ? 0 : sd / Math.sqrt(sampleCount),
      consistencyScore: consistencyFromStddev(sd, consistencyStddevCeiling),
      meanLatencyMs: mean(bucket.latencies),
      meanCostUsd: mean(bucket.costs),
      totalCostUsd: bucket.totalCost,
      completedCount,
      failedCount: bucket.failedCount,
      failureRate: totalRows === 0 ? 0 : bucket.failedCount / totalRows,
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
// latency/cost candidate to still contribute to quality-driven ranking).
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
      const compositeScore = COMPOSITE_QUALITY_WEIGHT * quality + efficiency;
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
  candidate.failureRate <= MAX_FAILURE_RATE_FOR_RECOMMENDATION;

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
      };
      buckets.set(key, bucket);
    }

    if (r.status === "failed") {
      bucket.finalScores.push(0);
      bucket.accuracies.push(0);
      bucket.coherences.push(0);
      bucket.instructions.push(0);
      bucket.latencies.push(r.latencyMs);
      bucket.costs.push(r.totalCostUsd);
      bucket.failedCount += 1;
      continue;
    }

    bucket.finalScores.push(r.finalScore);
    bucket.accuracies.push(r.judgeAccuracy);
    bucket.coherences.push(r.judgeCoherence);
    bucket.instructions.push(r.judgeInstruction);
    bucket.latencies.push(r.latencyMs);
    bucket.costs.push(r.totalCostUsd);
    bucket.completedCount += 1;
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
      };
    })
    .sort((a, b) => {
      if (a.category === b.category) {
        return a.candidateKey.localeCompare(b.candidateKey);
      }
      return String(a.category).localeCompare(String(b.category));
    });
};

const effectSizeLabel = (d: number): PairwiseComparison["effectLabel"] => {
  const abs = Math.abs(d);
  if (abs < 0.2) return "negligible";
  if (abs < 0.5) return "small";
  if (abs < 0.8) return "medium";
  return "large";
};

const computePairwiseComparisons = (
  candidates: readonly CandidateStats[],
  results: readonly BenchmarkResult[],
): PairwiseComparison[] => {
  const reliable = candidates.filter(isReliableForComparativeViews);
  if (reliable.length < 2) return [];

  const rowsByCandidate = new Map<string, BenchmarkResult[]>();
  for (const row of results) {
    const key = candidateKey(row);
    rowsByCandidate.set(key, [...(rowsByCandidate.get(key) ?? []), row]);
  }

  const comparisons: PairwiseComparison[] = [];
  for (let i = 0; i < reliable.length; i += 1) {
    for (let j = i + 1; j < reliable.length; j += 1) {
      const a = reliable[i]!;
      const b = reliable[j]!;
      const aRows = rowsByCandidate.get(a.candidateKey) ?? [];
      const bRows = rowsByCandidate.get(b.candidateKey) ?? [];
      const ci = pairedDifferenceCI(aRows, bRows);

      const pooledSd = Math.sqrt(
        (stddev(aRows.map((r) => r.status === "failed" ? 0 : r.finalScore)) ** 2 +
          stddev(bRows.map((r) => r.status === "failed" ? 0 : r.finalScore)) ** 2) /
          2,
      );
      const diff = a.meanFinalScore - b.meanFinalScore;
      const d = pooledSd > 0 ? diff / pooledSd : 0;

      comparisons.push({
        candidateKeyA: a.candidateKey,
        candidateKeyB: b.candidateKey,
        meanDiff: diff,
        ci95Low: ci?.low ?? diff,
        ci95High: ci?.high ?? diff,
        isSignificant: ci ? ci.low > 0 || ci.high < 0 : false,
        effectSize: d,
        effectLabel: effectSizeLabel(d),
      });
    }
  }
  return comparisons;
};

const computeVarianceDecomposition = (
  results: readonly BenchmarkResult[],
): VarianceDecomposition => {
  const completedScores = results
    .filter((r) => r.status === "completed")
    .map((r) => r.finalScore);
  const totalVar = variance(completedScores);

  const byConfig = new Map<string, Map<string, number[]>>();
  for (const r of results) {
    if (r.status !== "completed") continue;
    const configKey = candidateKey(r);
    if (!byConfig.has(configKey)) byConfig.set(configKey, new Map());
    const testCaseBucket = byConfig.get(configKey)!;
    const bucket = testCaseBucket.get(r.testCaseId) ?? [];
    bucket.push(r.finalScore);
    testCaseBucket.set(r.testCaseId, bucket);
  }

  const withinRunVars: number[] = [];
  const configMeans: number[] = [];
  for (const testCaseBuckets of byConfig.values()) {
    const allScoresForConfig: number[] = [];
    for (const scores of testCaseBuckets.values()) {
      if (scores.length > 1) withinRunVars.push(variance(scores));
      allScoresForConfig.push(...scores);
    }
    const testCaseMeans = [...testCaseBuckets.values()].map((s) => mean(s));
    if (testCaseMeans.length > 1) {
      configMeans.push(variance(testCaseMeans));
    }
  }

  return {
    totalVariance: totalVar,
    withinRunVariance: withinRunVars.length > 0 ? mean(withinRunVars) : 0,
    acrossTestCaseVariance: configMeans.length > 0 ? mean(configMeans) : 0,
  };
};

const Z_ALPHA_HALF = 1.96;
const Z_BETA_80 = 0.84;
const MIN_DETECTABLE_DIFF = 0.1;

const computeSuggestedRepetitions = (
  candidates: readonly CandidateStats[],
): { count: number; rationale: string } => {
  const reliable = candidates.filter((c) => c.completedCount > 0);
  if (reliable.length === 0) {
    return { count: 3, rationale: "No completed results to estimate variance." };
  }
  const pooledStderr = mean(reliable.map((c) => c.stderr));
  const sampleSizes = reliable.map((c) => c.completedCount + c.failedCount);
  const avgN = mean(sampleSizes);
  const estimatedSd = pooledStderr * Math.sqrt(avgN);
  if (estimatedSd <= 0) {
    return { count: 3, rationale: "Scores are perfectly consistent; minimum repetitions suffice." };
  }
  const required = Math.ceil(
    (2 * ((Z_ALPHA_HALF + Z_BETA_80) ** 2) * estimatedSd ** 2) /
      MIN_DETECTABLE_DIFF ** 2,
  );
  const clamped = Math.max(3, Math.min(50, required));
  return {
    count: clamped,
    rationale:
      `Pooled SD=${estimatedSd.toFixed(3)}. To detect a ${MIN_DETECTABLE_DIFF} point ` +
      `difference at 95% confidence / 80% power: ~${clamped} repetitions per cell.`,
  };
};

const computeExclusionReasons = (
  candidates: readonly CandidateStats[],
  ranking: readonly CompositeRanking[],
): Record<string, string> => {
  const rankedKeys = new Set(ranking.map((r) => r.candidateKey));
  const reasons: Record<string, string> = {};
  for (const c of candidates) {
    if (rankedKeys.has(c.candidateKey)) continue;
    if (c.completedCount === 0) {
      reasons[c.candidateKey] = "No completed results — all runs failed.";
    } else if (c.failureRate > MAX_FAILURE_RATE_FOR_RECOMMENDATION) {
      reasons[c.candidateKey] =
        `Failure rate ${(c.failureRate * 100).toFixed(1)}% exceeds ` +
        `${(MAX_FAILURE_RATE_FOR_RECOMMENDATION * 100).toFixed(0)}% reliability threshold.`;
    }
  }
  return reasons;
};

export const computeAnalysis = (
  results: readonly BenchmarkResult[],
  options: AnalyzerOptions = {},
): Omit<BenchmarkAnalysis, "commentary"> => {
  const candidates = aggregateResults(
    results,
    options.consistencyStddevCeiling ?? DEFAULT_CONSISTENCY_STDDEV_CEILING,
  );
  const categoryBreakdown = aggregateCategoryBreakdown(
    results,
    options.testCasesById ?? {},
  );
  const paretoFrontierKeys = computeParetoFrontier(candidates).map((c) => c.candidateKey);

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
      pairwiseComparisons: [],
      varianceDecomposition: { totalVariance: 0, withinRunVariance: 0, acrossTestCaseVariance: 0 },
      exclusionReasons: computeExclusionReasons(candidates, []),
      suggestedRepetitions: 3,
      suggestedRepetitionsRationale: "No completed results to estimate variance.",
    };
  }

  const bestScore = Math.max(...completed.map((c) => c.meanFinalScore));
  const fraction = options.minScoreFraction ?? SCORE_FLOOR_FRACTION;
  const scoreFloor = bestScore * fraction;

  const baseline = pickBaseline(candidates, scoreFloor);
  const baselineKey = baseline ? baseline.candidateKey : null;

  const ranking = computeCompositeRanking(candidates);
  // Recommendation order: (1) clear score floor, (2) failure rate below
  // threshold, (3) highest composite, (4) tie-break on CI overlap by cheaper
  // mean cost. The failure gate makes reliability a precondition rather than
  // just another weighted term; CI-overlap tie-break prevents picking a
  // marginally-higher-composite candidate when the difference is within
  // sampling noise.
  const eligibleKeys = new Set(
    completed
      .filter(
        (c) =>
          c.meanFinalScore >= scoreFloor &&
          c.failureRate <= MAX_FAILURE_RATE_FOR_RECOMMENDATION,
      )
      .map((c) => c.candidateKey),
  );
  const eligibleRanking = ranking.filter((r) => eligibleKeys.has(r.candidateKey));
  const recommended = pickWithPairedSignificanceTieBreak(
    eligibleRanking,
    completed,
    results,
  );
  const recommendedKey = recommended?.rank.candidateKey ?? null;
  const recommendedStats = recommendedKey
    ? completed.find((c) => c.candidateKey === recommendedKey) ?? null
    : null;

  const ppd =
    baseline && baseline.totalCostUsd > 0 && baseline.meanFinalScore > 0
      ? computePPD(candidates, baseline)
      : [];

  const pairwiseComparisons = computePairwiseComparisons(candidates, results);
  const varianceDecomposition = computeVarianceDecomposition(results);
  const exclusionReasons = computeExclusionReasons(candidates, ranking);
  const power = computeSuggestedRepetitions(candidates);

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
          topCompositeKey: eligibleRanking[0]?.candidateKey ?? null,
          selectedKey: null,
          comparedAgainstKey: null,
          pairedDiffCiLow: null,
          pairedDiffCiHigh: null,
        },
    pairwiseComparisons,
    varianceDecomposition,
    exclusionReasons,
    suggestedRepetitions: power.count,
    suggestedRepetitionsRationale: power.rationale,
  };
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

  const diffs = sharedKeys.map((key) => {
    const l = left.get(key);
    const r = right.get(key);
    return (l?.status === "failed" ? 0 : l?.finalScore ?? 0) -
      (r?.status === "failed" ? 0 : r?.finalScore ?? 0);
  });
  const rng = mulberry32(hashString(sharedKeys.join("|")));
  return bootstrapCI(diffs, rng);
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
  `Latency ${Math.round(s.meanLatencyMs)} ms, ` +
  `Cost $${s.meanCostUsd.toFixed(4)}/test.`;

export class BenchmarkAnalyzer {
  constructor(private readonly providers: IAIProviderFactory) {}

  async analyze(
    results: readonly BenchmarkResult[],
    testCasesById: Record<string, Pick<BenchmarkTestCase, "category" | "source">>,
    versionLabels: Record<string, string>,
    commentaryModel: string,
  ): Promise<BenchmarkAnalysis> {
    const core = computeAnalysis(results, { testCasesById });
    if (core.candidates.every((c) => c.completedCount === 0)) {
      return { ...core, commentary: "No completed results to analyze." };
    }
    let commentary: string;
    try {
      commentary = await this.generateCommentary(
        core.candidates,
        versionLabels,
        commentaryModel,
      );
    } catch {
      commentary = "Commentary generation failed. Deterministic analysis above remains valid.";
    }
    return { ...core, commentary };
  }

  private async generateCommentary(
    candidates: readonly CandidateStats[],
    versionLabels: Record<string, string>,
    commentaryModel: string,
  ): Promise<string> {
    const candidateLines = candidates
      .filter((c) => c.completedCount > 0)
      .map((c) => {
        const vLabel = versionLabels[c.promptVersionId] ?? c.promptVersionId.slice(-6);
        return [
          `Candidate: ${vLabel} × ${c.solverModel}`,
          `  Final score (mean):  ${c.meanFinalScore.toFixed(3)} (95% CI [${c.ci95Low.toFixed(3)}, ${c.ci95High.toFixed(3)}])`,
          `  Accuracy (1-5):      ${c.meanAccuracy.toFixed(2)}`,
          `  Coherence (1-5):     ${c.meanCoherence.toFixed(2)}`,
          `  Instruction (1-5):   ${c.meanInstruction.toFixed(2)}`,
          `  Consistency:         ${(c.consistencyScore * 100).toFixed(1)}%`,
          `  Avg latency:         ${Math.round(c.meanLatencyMs)} ms`,
          `  Avg cost/test:       $${c.meanCostUsd.toFixed(4)}`,
          `  Completed rows:      ${c.completedCount}`,
          `  Failure rate:        ${(c.failureRate * 100).toFixed(1)}%`,
        ].join("\n");
      })
      .join("\n\n");

    const prompt = `You are analyzing LLM benchmark results across prompt versions and solver models.

Per-candidate statistics:

${candidateLines}

Rubric dimensions:
- Accuracy: Does the response correctly answer the question? (1=very wrong, 5=perfect)
- Coherence: Is the response logically structured and easy to follow? (1=incoherent, 5=excellent)
- Instruction: Does the response follow the prompt instructions? (1=ignores instructions, 5=follows perfectly)
- Consistency (%): Stability of scores across runs — 100% means the candidate scored identically on every run.
- 95% CI: Bootstrap confidence interval on mean final score; two candidates whose CIs overlap are not statistically separable from this sample.
- Avg latency: Mean response time per row.
- Avg cost/test: Mean total LLM cost (candidate + ensemble of judges) per row in USD.

Write a detailed analysis paragraph (3-5 sentences) comparing each candidate across all dimensions. Call out where CIs overlap vs. where one candidate is clearly ahead. Do not include a recommendation — just the analysis.

Return only the paragraph text, no JSON, no headings.`;

    const provider = this.providers.forModel(commentaryModel);
    const response = await provider.generate({
      model: commentaryModel,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    });
    return response.text.trim();
  }
}

// Helpers.

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;

const variance = (values: readonly number[]): number => {
  if (values.length < 2) return 0;
  const m = mean(values);
  return values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
};

const stddev = (values: readonly number[]): number => Math.sqrt(variance(values));

const consistencyFromStddev = (
  sd: number,
  ceiling: number = DEFAULT_CONSISTENCY_STDDEV_CEILING,
): number => {
  if (ceiling <= 0) return sd === 0 ? 1 : 0;
  return Math.max(0, Math.min(1, 1 - sd / ceiling));
};

const bootstrapCI = (
  values: readonly number[],
  rng: () => number,
): { low: number; high: number } => {
  if (values.length === 0) return { low: 0, high: 0 };
  if (values.length === 1) {
    const only = values[0] ?? 0;
    return { low: only, high: only };
  }
  const samples: number[] = new Array(BOOTSTRAP_SAMPLES);
  for (let i = 0; i < BOOTSTRAP_SAMPLES; i += 1) {
    let sum = 0;
    for (let j = 0; j < values.length; j += 1) {
      const idx = Math.floor(rng() * values.length);
      sum += values[idx] ?? 0;
    }
    samples[i] = sum / values.length;
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
