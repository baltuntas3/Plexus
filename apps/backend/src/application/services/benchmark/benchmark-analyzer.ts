// Single unified analyzer for a benchmark run.
//
// Every candidate is (promptVersionId × solverModel). For each candidate the
// analyzer computes: rubric means across all graded rows, a consistency score
// from across-row variance, mean solver latency + cost, total cost, and a cluster
// bootstrap 95% confidence interval on `meanFinalScore` so two candidates
// can be compared as "significantly different vs. within noise".
//
// Two distinct quality scales coexist intentionally:
// - `meanFinalScore`, `ci95Low/High`, `ppd` and `paretoFrontier` operate on
//   the RAW [0, 1] rubric mean (`(rubricMean - 1) / 4`). These are absolute,
//   chart-friendly numbers — what the UI labels "Avg score", what PPD divides
//   into the cost ratio, and what Pareto compares for dominance.
// - The composite ranking pipeline (`computeCompositeRanking`) maps each
//   rubric dimension and the consistency score onto [0.1, 1.0] before
//   feeding them into a weighted geometric mean. The 0.1 floor is a policy
//   choice (see `normaliseRubricMean` and the doc on
//   `computeCompositeRanking`) — without it, a single rubric dimension
//   bottoming out at integer 1 would force the whole geometric mean to
//   zero and dominate every other signal. Composite is therefore NOT
//   directly comparable to `meanFinalScore` and is never sent through PPD
//   or Pareto. UI surfaces both deliberately: PPD/Pareto for absolute
//   trade-off views, composite for the recommendation rule.
//
// The analyzer then produces three ranked views:
//
//   1. Pareto frontier on (maximize meanFinalScore, minimize totalCostUsd) —
//      non-dominated candidates are highlighted in the UI.
//   2. PPD vs. a score-floor-eligible baseline (most expensive reliable
//      candidate that clears the 80% score floor; falls back to the highest-
//      scoring reliable candidate when nobody clears the floor). This is the
//      "expensive incumbent" the paper's PPD framing measures lift against
//      and is independent of the Pareto frontier.
//   3. Composite ranking: quality (80%, geometric mean of normalised rubric
//      dimensions + consistency) plus efficiency (20%, harmonic-against-best
//      normalised solver latency + cost — `bestValue / max(bestValue, value)`, so
//      the cheapest/fastest in the cohort scores 1 and outliers do not
//      collapse the rest of the field). The composite is the recommended-selection rule,
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

import {
  judgeRubricAggregate,
  type BenchmarkResult,
  type JudgeVote,
} from "../../../domain/entities/benchmark-result.js";
import type { BenchmarkTestCase } from "../../../domain/entities/benchmark.js";
import { computePPD } from "../../../domain/value-objects/ppd.js";
import { fnv1a } from "../../utils/fnv1a.js";
import { mean } from "../../utils/statistics.js";

const BOOTSTRAP_SAMPLES = 10_000;
const BOOTSTRAP_SEED = 0x9e3779b9;
const SCORE_FLOOR_FRACTION = 0.8;
// A candidate whose operational-issue rate exceeds this threshold is not
// eligible to be the recommendation — reliability is a precondition for
// "best", not a knob to trade against a high mean score.
const MAX_OPERATIONAL_ISSUE_RATE_FOR_RECOMMENDATION = 0.1;

// finalScore is in [0,1]. Consistency measures within-testCase repetition
// variance, not the natural spread between easy and hard test cases. A
// within-case stddev of 0.4 is already severe, so anything above it clamps
// to 0% consistency.
const CONSISTENCY_STDDEV_CEILING = 0.4;

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

interface CandidateStats {
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
  meanSolverLatencyMs: number;
  meanCostUsd: number;
  totalCostUsd: number;
  completedCount: number;
  failedCount: number;
  failureRate: number;
  operationalIssueCount: number;
  operationalIssueRate: number;
}

interface PPDRow {
  candidateKey: string;
  ppd: number;
  isMoreEfficient: boolean;
}

interface CompositeRanking {
  candidateKey: string;
  compositeScore: number;
}

type CategoryKey = NonNullable<BenchmarkTestCase["category"]> | "manual" | "uncategorized";

interface CategoryBreakdownRow {
  candidateKey: string;
  promptVersionId: string;
  solverModel: string;
  category: CategoryKey;
  meanFinalScore: number;
  meanAccuracy: number;
  meanCoherence: number;
  meanInstruction: number;
  meanSolverLatencyMs: number;
  meanCostUsd: number;
  completedCount: number;
  failedCount: number;
  failureRate: number;
  operationalIssueCount: number;
  operationalIssueRate: number;
}

interface JudgeAgreementRow {
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
interface EnsembleJudgeQuote {
  testCaseId: string;
  runIndex: number;
  finalScore: number;
  rubric: { accuracy: number; coherence: number; instruction: number };
  reasoning: string;
}

interface EnsembleJudgePerJudge {
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

interface EnsembleJudgeDisagreement {
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

interface EnsembleJudgeCandidateReport {
  candidateKey: string;
  promptVersionId: string;
  solverModel: string;
  judges: EnsembleJudgePerJudge[];
  // The single completed row where graders disagreed most. Null when fewer
  // than two judges contributed votes to any row of the candidate.
  maxDisagreement: EnsembleJudgeDisagreement | null;
}

interface EnsembleJudgeReport {
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

interface RecommendationDecision {
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

// Per-analysis cross-reference index. Built once at the top of
// computeAnalysis from the row set, then passed to every helper that
// needs to look up rows by candidate or per-row rubric data. Without
// this index, each helper rebuilt its own rowsByCandidate map and
// recomputed `judgeRubricAggregate` on the same rows — turning an
// O(rows) job into roughly O(rows × consumers).
interface AnalysisIndex {
  // Every result, keyed by candidate (promptVersionId::solverModel).
  // Includes failed rows (consumers like coverage signature need them).
  rowsByCandidate: ReadonlyMap<string, BenchmarkResult[]>;
  // Full rubric aggregate for every COMPLETED row with at least one judge
  // vote, keyed by row id. Failed rows and judge-fail-only completed rows
  // are absent — they have no rubric and consumers must skip them anyway.
  // Tracking the full aggregate (not just finalScore) lets the per-
  // candidate and per-(candidate, category) bucket fillers reuse the same
  // single computation instead of recomputing accuracies/coherences/
  // instructions every aggregation pass.
  rubricByRowId: ReadonlyMap<string, ReturnType<typeof judgeRubricAggregate>>;
}

const buildAnalysisIndex = (
  results: readonly BenchmarkResult[],
): AnalysisIndex => {
  const rowsByCandidate = new Map<string, BenchmarkResult[]>();
  const rubricByRowId = new Map<string, ReturnType<typeof judgeRubricAggregate>>();
  for (const row of results) {
    const key = candidateKey(row);
    const bucket = rowsByCandidate.get(key);
    if (bucket) bucket.push(row);
    else rowsByCandidate.set(key, [row]);
    if (row.status === "completed" && row.judgeVotes.length > 0) {
      rubricByRowId.set(row.id, judgeRubricAggregate(row.judgeVotes));
    }
  }
  return { rowsByCandidate, rubricByRowId };
};

// Per-row metric accumulator shared by both aggregation passes (per-candidate
// and per-(candidate, category)). Latency/cost/operational-issue counters
// always advance — failed rows still pay wall time and provider cost. Only
// completed rows contribute rubric and finalScore samples; failed rows
// increment failedCount and stop there.
type MetricBucket = {
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

const emptyMetricBucket = (): MetricBucket => ({
  finalScores: [],
  accuracies: [],
  coherences: [],
  instructions: [],
  latencies: [],
  costs: [],
  completedCount: 0,
  failedCount: 0,
  operationalIssueCount: 0,
});

// Caller computes the rubric once per row (it is also needed for the
// per-test-case score cluster outside the bucket) and passes it in so
// neither side recomputes the same per-vote sums.
const accumulateMetricRow = (
  bucket: MetricBucket,
  r: BenchmarkResult,
  rubric: ReturnType<typeof judgeRubricAggregate> | null,
): void => {
  bucket.latencies.push(r.solverLatencyMs);
  bucket.costs.push(r.totalCostUsd);
  bucket.operationalIssueCount += operationalIssueWeight(r);
  if (r.status === "failed" || !rubric) {
    bucket.failedCount += 1;
    return;
  }
  bucket.finalScores.push(rubric.finalScore);
  bucket.accuracies.push(rubric.accuracy);
  bucket.coherences.push(rubric.coherence);
  bucket.instructions.push(rubric.instruction);
  bucket.completedCount += 1;
};

export const aggregateResults = (
  results: readonly BenchmarkResult[],
  precomputedIndex?: AnalysisIndex,
): CandidateStats[] => {
  // Reps grouped by testCaseId. The runner judges all reps of the same
  // (candidate, testCase) in a single batched LLM call, so per-rep noise
  // is correlated within these groups. The CI is computed via cluster
  // bootstrap over these groups so the resampling distribution preserves
  // that correlation; treating reps as i.i.d. would understate spread.
  // The optional `precomputedIndex` lets computeAnalysis share its single
  // rubric pass with this aggregator; direct callers (tests, ad-hoc) omit
  // it and we fall back to inline rubric computation per row.
  const rubricByRowId = precomputedIndex?.rubricByRowId;
  type Bucket = MetricBucket & {
    promptVersionId: string;
    solverModel: string;
    scoresByTestCase: Map<string, number[]>;
    totalCost: number;
  };
  const buckets = new Map<string, Bucket>();

  for (const r of results) {
    const key = candidateKey(r);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        ...emptyMetricBucket(),
        promptVersionId: r.promptVersionId,
        solverModel: r.solverModel,
        scoresByTestCase: new Map(),
        totalCost: 0,
      };
      buckets.set(key, bucket);
    }
    bucket.totalCost += r.totalCostUsd;
    const rubric =
      r.status === "failed"
        ? null
        : rubricByRowId?.get(r.id) ?? judgeRubricAggregate(r.judgeVotes);
    accumulateMetricRow(bucket, r, rubric);
    if (rubric) {
      const cluster = bucket.scoresByTestCase.get(r.testCaseId) ?? [];
      cluster.push(rubric.finalScore);
      bucket.scoresByTestCase.set(r.testCaseId, cluster);
    }
  }

  const out: CandidateStats[] = [];
  for (const [key, bucket] of buckets) {
    const completedCount = bucket.completedCount;
    const withinCaseStddev = pooledWithinClusterStddev(
      [...bucket.scoresByTestCase.values()],
    );
    const ci = clusterBootstrapCI(
      [...bucket.scoresByTestCase.values()],
      mulberry32(fnv1a(BOOTSTRAP_SEED, key)),
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
      consistencyScore: consistencyFromStddev(withinCaseStddev),
      meanSolverLatencyMs: mean(bucket.latencies),
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

// Picks the PPD baseline as the most expensive reliable candidate clearing
// the score floor — the "expensive incumbent" PPD compares lift against.
// When no candidate clears the floor, falls back to the highest-scoring
// reliable candidate so PPD still has a reference even on a weak benchmark.
// Unrelated to the Pareto frontier: the baseline can sit on or off the
// frontier depending on the cohort.
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

const buildPPDRows = (
  candidates: readonly CandidateStats[],
  baseline: CandidateStats,
): PPDRow[] =>
  candidates
    .filter(isReliableForComparativeViews)
    .map((c) => {
      const score = computePPD(
        { accuracy: c.meanFinalScore, costUsd: c.totalCostUsd },
        { accuracy: baseline.meanFinalScore, costUsd: baseline.totalCostUsd },
      );
      return {
        candidateKey: c.candidateKey,
        ppd: score.value,
        isMoreEfficient: score.isMoreEfficient,
      };
    });

// Composite score: weighted combination of quality (weighted geometric mean
// across normalised rubric means + consistency) and efficiency (additive,
// against-best harmonic on solver latency + cost), followed by a soft
// reliability multiplier. Quality dimensions are clamped to a 0.1 floor
// before the geometric mean so a single near-zero rubric drags the score
// hard but does not collapse it to literal zero — the alternative (no
// floor) would let one rubric dimension at the integer-valid bottom of
// the scale (rubric = 1, normalised → 0.1) annihilate every other signal
// when combined with consistency at zero. The floor is part of the policy,
// not a numerical safety net; raising or lowering it changes how punishing
// the geometric mean is in practice.
//
// The reliability multiplier is intentionally dual-coded with the rubric
// pipeline: rubric aggregation skips failed rows (which would otherwise
// drag means down), and this multiplier separately discounts the composite
// by operational issue rate. The two are not double-counting the same
// observation — they price the same incident on two different axes (what
// the candidate produced when it worked, and how often it failed to
// produce anything) — but they DO compound, which is intentional. A flaky
// candidate that scores well on its surviving rows is meant to lose to a
// reliable candidate of similar quality.
//
// Weights live in the module-level COMPOSITE_/QUALITY_/EFFICIENCY_ constants
// above so the policy is greppable in one place.
const computeCompositeRanking = (
  candidates: readonly CandidateStats[],
): CompositeRanking[] => {
  const eligible = candidates.filter(isReliableForComparativeViews);
  if (eligible.length === 0) return [];

  // Compute the cohort minimum once per dimension (was O(n²) per candidate
  // before).
  const bestLatency = minOf(eligible, (c) => c.meanSolverLatencyMs);
  const bestCost = minOf(eligible, (c) => c.meanCostUsd);

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
          normaliseDescending(c.meanSolverLatencyMs, bestLatency) +
        EFFICIENCY_COST_WEIGHT *
          normaliseDescending(c.meanCostUsd, bestCost);
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

// Returns the smallest STRICTLY POSITIVE pick(item) across the cohort —
// used by efficiency normalisation as the "best" reference value (lowest
// non-zero latency / cost). Zero or negative observations are skipped:
// a candidate with `meanCostUsd = 0` (e.g. provider that did not report
// usage on a failed row) would otherwise drag bestCost down to 0,
// `normaliseDescending` would then short-circuit to 1 for EVERY
// candidate, and the cost dimension of efficiency would silently
// collapse for the whole cohort. Skipping non-positive values keeps the
// reference "best" anchored to a candidate that actually carries cost
// signal. When no candidate has a positive observation, returns 0 and
// `normaliseDescending` consistently emits 1 — that path is genuine
// "no signal", not the silent-collapse failure mode it used to cover.
const minOf = <T>(items: readonly T[], pick: (item: T) => number): number => {
  let min = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const value = pick(item);
    if (value > 0 && value < min) min = value;
  }
  return Number.isFinite(min) ? min : 0;
};

// Maps `value` against `bestValue` robustly. The absolute lowest (best)
// scores 1; as `value` grows against `bestValue`, the score falls
// harmonically. `bestValue / max(bestValue, value)` is naturally bounded
// to [0,1] and entirely prevents single extreme outliers from compressing
// the scores of everybody else.
const normaliseDescending = (value: number, bestValue: number): number => {
  if (value <= 0 || bestValue <= 0) return 1;
  return bestValue / Math.max(bestValue, value);
};

// Rubric means are the average of N integer judge votes in [1,5], so the
// domain-valid range is [1,5]. The Math.max/min clamps protect against
// floating-point drift; values outside [1,5] are not produceable by the
// upstream zod schema (`z.number().int().min(1).max(5)` per vote).
//
// The output range is intentionally [0.1, 1.0] (not [0, 1]): the 0.1 floor
// keeps the rubric input to the geometric mean strictly positive so a
// single rubric at the bottom of the integer scale does not annihilate the
// composite. This means the worst attainable rubric still contributes a
// non-zero factor to quality — penalising it heavily but not infinitely.
// See the doc on computeCompositeRanking for the policy rationale.
const normaliseRubricMean = (value: number): number => {
  const bounded = Math.max(1, Math.min(5, value));
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
  index: AnalysisIndex,
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

  for (const candidate of candidates) {
    if (!reliableKeys.has(candidate.candidateKey)) continue;
    const rows = index.rowsByCandidate.get(candidate.candidateKey) ?? [];
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

interface AnalyzerOptions {
  minScoreFraction?: number;
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
  precomputedIndex?: AnalysisIndex,
): CategoryBreakdownRow[] => {
  const rubricByRowId = precomputedIndex?.rubricByRowId;
  type Bucket = MetricBucket & {
    candidateKey: string;
    promptVersionId: string;
    solverModel: string;
    category: CategoryKey;
  };
  const buckets = new Map<string, Bucket>();

  for (const r of results) {
    const candidate = candidateKey(r);
    const category = categoryKeyForTestCase(testCasesById[r.testCaseId]);
    const key = `${candidate}::${category}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        ...emptyMetricBucket(),
        candidateKey: candidate,
        promptVersionId: r.promptVersionId,
        solverModel: r.solverModel,
        category,
      };
      buckets.set(key, bucket);
    }
    const rubric =
      r.status === "failed"
        ? null
        : rubricByRowId?.get(r.id) ?? judgeRubricAggregate(r.judgeVotes);
    accumulateMetricRow(bucket, r, rubric);
  }

  return [...buckets.values()]
    .map((bucket) => {
      const completedCount = bucket.completedCount;
      const totalRows = completedCount + bucket.failedCount;
      return {
        candidateKey: bucket.candidateKey,
        promptVersionId: bucket.promptVersionId,
        solverModel: bucket.solverModel,
        category: bucket.category,
        meanFinalScore: mean(bucket.finalScores),
        meanAccuracy: mean(bucket.accuracies),
        meanCoherence: mean(bucket.coherences),
        meanInstruction: mean(bucket.instructions),
        meanSolverLatencyMs: mean(bucket.latencies),
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
      // `agreementScore` is `1 - MAE/4`: the average absolute rubric
      // difference, normalised by the maximum possible diff on the
      // integer 1-5 scale (= 4), and inverted so 1 means "graders agree"
      // and 0 means "graders maximally disagree". This is NOT a
      // chance-corrected agreement metric (Cohen's κ, Krippendorff's α)
      // — it does not account for agreement expected by chance under the
      // observed marginal distributions, so two judges who happen to
      // cluster around the middle of the rubric will look more agreeable
      // than they really are. The simple MAE form is what the UI needs:
      // a per-pair number whose units are interpretable in rubric points.
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
  const index = buildAnalysisIndex(results);
  const candidates = aggregateResults(results, index);
  const categoryBreakdown = aggregateCategoryBreakdown(
    results,
    options.testCasesById ?? {},
    index,
  );
  const comparableCoverageKeys = pickComparableCoverageKeys(candidates, index);
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
  // Score floor is a RELATIVE gate (`bestScore * fraction`) and therefore
  // adapts to the cohort. With a single-candidate cohort, the floor
  // collapses to the best score itself — that single candidate clears it
  // by definition and is recommendable even if its absolute quality is
  // low. This is intentional: PPD/Pareto/composite are all comparative
  // views, and with one candidate there is nothing to compare against.
  // Callers that need an absolute "is this prompt good enough to deploy"
  // gate must enforce that policy upstream — the analyzer does not
  // pretend to make that judgement.
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
  // The recommendation is drawn from the largest comparable-coverage cohort
  // only — `pickComparableCoverageKeys` already restricts ranking, PPD and
  // Pareto to that cohort, so candidates with off-cohort coverage are absent
  // from `eligibleRanking` and never compete here. Reliable candidates that
  // sit outside the cohort surface in the candidate stats but do not block
  // a tip from being given on the ones we *can* compare honestly.
  const recommended = pickWithPairedSignificanceTieBreak(
    eligibleRanking,
    reliableCompleted.filter((candidate) => comparableCoverageKeys.has(candidate.candidateKey)),
    results,
    index,
  );
  const recommendedKey = recommended?.rank.candidateKey ?? null;
  const recommendedStats = recommendedKey
    ? reliableCompleted.find((c) => c.candidateKey === recommendedKey) ?? null
    : null;

  const ppd =
    baseline && baseline.totalCostUsd > 0 && baseline.meanFinalScore > 0
      ? buildPPDRows(comparableCandidates, baseline)
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
          topCompositeKey: eligibleRanking[0]?.candidateKey ?? null,
          selectedKey: null,
          comparedAgainstKey: null,
          pairedDiffCiLow: null,
          pairedDiffCiHigh: null,
        },
    judgeAgreement: computeJudgeAgreement(results),
    ensembleJudgeReport: buildEnsembleJudgeReport(candidates, index),
  };
};

// Returns the per-vote rubric mean on the RAW integer scale [1, 5] —
// NOT the normalised [0, 1] `finalScore` the UI displays. The two are
// monotonically related (`finalScore = (rubricMean - 1) / 4`) so any
// ordering done with `overallJudgeMean` matches the ordering you would
// get from `finalScore`. The function is internal-only; it exists to
// rank votes against each other when picking the per-judge top/bottom
// quote, where the absolute scale is irrelevant.
const overallJudgeMean = (vote: JudgeVote): number =>
  (vote.accuracy + vote.coherence + vote.instruction) / 3;

const buildQuoteFromVote = (
  row: BenchmarkResult,
  vote: JudgeVote,
  rowFinalScore: number,
): EnsembleJudgeQuote => ({
  testCaseId: row.testCaseId,
  runIndex: row.runIndex,
  finalScore: rowFinalScore,
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
  index: AnalysisIndex,
): EnsembleJudgeReport => {
  // Filter to completed-with-votes rows for the per-candidate report. The
  // shared index already contains every row by candidate; we just drop the
  // ones the report cannot consume.
  const completedRowsByCandidate = new Map<string, BenchmarkResult[]>();
  for (const [key, rows] of index.rowsByCandidate) {
    const usable = rows.filter(
      (row) => row.status === "completed" && row.judgeVotes.length > 0,
    );
    if (usable.length > 0) completedRowsByCandidate.set(key, usable);
  }

  const perCandidate: EnsembleJudgeCandidateReport[] = [];
  for (const candidate of candidates) {
    if (candidate.completedCount === 0) continue;
    const rows = completedRowsByCandidate.get(candidate.candidateKey) ?? [];
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
          topRated: top
            ? buildQuoteFromVote(top.row, top.vote, index.rubricByRowId.get(top.row.id)?.finalScore ?? 0)
            : null,
          bottomRated:
            bottom && bottom !== top
              ? buildQuoteFromVote(
                  bottom.row,
                  bottom.vote,
                  index.rubricByRowId.get(bottom.row.id)?.finalScore ?? 0,
                )
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
  rubricByRowId: AnalysisIndex["rubricByRowId"],
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
    const lScore = rubricByRowId.get(l.id)?.finalScore ?? 0;
    const rScore = rubricByRowId.get(r.id)?.finalScore ?? 0;
    bucket.push(lScore - rScore);
    diffsByTestCase.set(l.testCaseId, bucket);
  }
  // Need at least two distinct testCase clusters AND at least two diffs
  // overall for the cluster bootstrap to actually carry information about
  // input-coverage uncertainty. With a single cluster the resampler can
  // only ever draw that cluster, so the CI collapses to a point centred on
  // the cluster mean and the downstream tie-break would mistake "no
  // signal" for "0 ∈ CI ⇒ tied" — see callers.
  const clustersWithDiffs = [...diffsByTestCase.values()].filter(
    (bucket) => bucket.length > 0,
  );
  const totalDiffs = clustersWithDiffs.reduce(
    (sum, bucket) => sum + bucket.length,
    0,
  );
  if (clustersWithDiffs.length < 2 || totalDiffs < 2) return null;
  const rng = mulberry32(fnv1a(BOOTSTRAP_SEED, sharedKeys.join("|")));
  return clusterBootstrapCI(clustersWithDiffs, rng);
};

// Pick the top-composite candidate; if any runner-up is not statistically
// separable from the top under paired bootstrap of per-cell score
// differences, prefer the cheapest candidate among that tied set.
//
// Transitivity guard: "not statistically separable" is a pairwise relation
// and is NOT transitive. top↔A and top↔B may both be tied while A↔B is
// separable. If the cheapest tied candidate fails this transitivity
// check (it is separable from another tied member that is also tied with
// top), the tie set is internally inconsistent and we fall back to the
// top — picking the cheapest in that situation could swap to a candidate
// that is statistically WORSE than another tied alternative, which would
// undermine the "cheap among tied equals" intent of the tie-break.
export const pickWithPairedSignificanceTieBreak = (
  ranking: readonly CompositeRanking[],
  completed: readonly CandidateStats[],
  results: readonly BenchmarkResult[],
  precomputedIndex?: AnalysisIndex,
): {
  rank: CompositeRanking;
  mode: "top_composite" | "paired_cost_tie_break";
  topCompositeKey: string;
  comparedAgainstKey: string | null;
  pairedDiffCi: { low: number; high: number } | null;
} | null => {
  if (ranking.length === 0) return null;
  const byKey = new Map(completed.map((c) => [c.candidateKey, c] as const));
  // computeAnalysis passes the shared index so the inner pairwise loop can
  // look up final scores in O(1) without rebuilding them. Direct callers
  // (tests, ad-hoc) can omit it; we build a local index in that case so
  // the function stays callable as a unit.
  const index = precomputedIndex ?? buildAnalysisIndex(results);
  const { rowsByCandidate, rubricByRowId } = index;
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

  // Tie test is paired-bootstrap only. When the paired CI is unavailable
  // (fewer than two testCase clusters with shared coverage), there is no
  // honest evidence of equivalence — falling back to the marginal CI
  // overlap on the candidates' own scores would manufacture a "tied"
  // verdict in exactly the small-benchmark regime where the marginal CIs
  // are themselves degenerate (single-cluster point estimates). Default
  // to "not tied" so the recommendation falls back to the top-composite.
  const isPairTied = (
    aKey: string,
    bKey: string,
    _aStats: CandidateStats,
    _bStats: CandidateStats,
  ): { tied: boolean; diffCi: { low: number; high: number } | null } => {
    const diffCi = pairedDifferenceCI(
      rowsByCandidate.get(aKey) ?? [],
      rowsByCandidate.get(bKey) ?? [],
      rubricByRowId,
    );
    if (!diffCi) return { tied: false, diffCi: null };
    return { tied: diffCi.low <= 0 && diffCi.high >= 0, diffCi };
  };

  // 1) Collect all candidates tied with the top under paired bootstrap.
  interface TiedEntry {
    rank: CompositeRanking;
    stats: CandidateStats;
    diffCiVsTop: { low: number; high: number } | null;
  }
  const tiedWithTop: TiedEntry[] = [];
  for (const other of ranking.slice(1)) {
    const otherStats = byKey.get(other.candidateKey);
    if (!otherStats) continue;
    const { tied, diffCi } = isPairTied(
      top.candidateKey,
      other.candidateKey,
      topStats,
      otherStats,
    );
    if (tied) {
      tiedWithTop.push({ rank: other, stats: otherStats, diffCiVsTop: diffCi });
    }
  }

  if (tiedWithTop.length === 0) {
    return {
      rank: top,
      mode: "top_composite",
      topCompositeKey: top.candidateKey,
      comparedAgainstKey: null,
      pairedDiffCi: null,
    };
  }

  // 2) Cheapest among tied (including the top itself, so the tie-break
  // never preserves a more-expensive top when a cheaper tied alternative
  // exists).
  let cheapest: { rank: CompositeRanking; stats: CandidateStats; diffCiVsTop: { low: number; high: number } | null } = {
    rank: top,
    stats: topStats,
    diffCiVsTop: null,
  };
  for (const entry of tiedWithTop) {
    if (entry.stats.meanCostUsd < cheapest.stats.meanCostUsd) {
      cheapest = entry;
    }
  }

  if (cheapest.rank.candidateKey === top.candidateKey) {
    return {
      rank: top,
      mode: "top_composite",
      topCompositeKey: top.candidateKey,
      comparedAgainstKey: null,
      pairedDiffCi: null,
    };
  }

  // 3) Transitivity guard: cheapest must also be tied with every OTHER
  // tied-with-top member. If it is statistically separable from one of
  // them, the tie set is inconsistent and falling through to the cheapest
  // could swap in a candidate that is worse than another tied alternative.
  for (const entry of tiedWithTop) {
    if (entry.rank.candidateKey === cheapest.rank.candidateKey) continue;
    const { tied } = isPairTied(
      cheapest.rank.candidateKey,
      entry.rank.candidateKey,
      cheapest.stats,
      entry.stats,
    );
    if (!tied) {
      return {
        rank: top,
        mode: "top_composite",
        topCompositeKey: top.candidateKey,
        comparedAgainstKey: null,
        pairedDiffCi: null,
      };
    }
  }

  return {
    rank: cheapest.rank,
    mode: "paired_cost_tie_break",
    topCompositeKey: top.candidateKey,
    comparedAgainstKey: top.candidateKey,
    pairedDiffCi: cheapest.diffCiVsTop,
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
  `Solver latency ${Math.round(s.meanSolverLatencyMs)} ms, ` +
  `Cost $${s.meanCostUsd.toFixed(4)}/test.`;

const operationalIssueWeight = (row: BenchmarkResult): number => {
  if (row.status === "failed") return 1;
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

// Pooled within-cluster standard deviation. Each cluster contributes its
// sample variance weighted by (n_g - 1) — so a cluster with 10 reps speaks
// 9× louder than a cluster with 2 reps about how noisy the within-case
// signal really is. The previous implementation averaged the per-cluster
// stddevs unweighted, which let a single noisy 2-rep cluster move the
// number as much as a stable 10-rep cluster. Formula:
//   sigma_pooled = sqrt( Σ (n_g - 1) · s_g² / Σ (n_g - 1) )
// Reduces to a single cluster's sample stddev when only one cluster has
// reps, and to 0 when no cluster has reps.
const pooledWithinClusterStddev = (
  groups: readonly (readonly number[])[],
): number => {
  const repeated = groups.filter((group) => group.length >= 2);
  if (repeated.length === 0) return 0;
  let weightedVarianceSum = 0;
  let degreesOfFreedom = 0;
  for (const group of repeated) {
    const dof = group.length - 1;
    const s = stddev(group);
    weightedVarianceSum += dof * s * s;
    degreesOfFreedom += dof;
  }
  if (degreesOfFreedom <= 0) return 0;
  return Math.sqrt(weightedVarianceSum / degreesOfFreedom);
};

// Linear taper from 1 (sd=0) to 0 (sd=CEILING). Clamped at the ends so the
// score stays in [0,1]. The mapping is intentionally linear: rubric judges
// emit integer scores in [1,5] which the analyzer normalises into [0,1],
// so within-case stddev sits in roughly [0, 0.5]. Inside that narrow band
// a simple linear scale is more interpretable to UI readers than an
// exp/log taper, and a 1-point average swing in the integer rubric (sd
// around 0.25 in the [0,1] view) maps cleanly to ~37.5% consistency under
// the 0.4 ceiling.
const consistencyFromStddev = (sd: number): number => {
  return Math.max(0, Math.min(1, 1 - sd / CONSISTENCY_STDDEV_CEILING));
};

// Cluster (block) bootstrap on the mean. `groups` are clusters of
// observations that share judging-session noise — typically one cluster
// per testCaseId, holding all reps that were graded in the same batched
// judge call. Resampling whole clusters with replacement preserves the
// intra-cluster correlation that an i.i.d. row-level bootstrap would
// erase, so the resulting CI is honest about how much information the
// reps actually carry. Reduces to standard bootstrap when every cluster
// has size 1 (i.e. repetitions == 1).
//
// Resampling unit is the cluster (selected uniformly with replacement
// among `nonEmpty`). The bootstrap mean is computed over ALL observations
// inside the resampled clusters, not over the K cluster means. With
// uniform cluster selection, larger clusters automatically contribute
// more observations to a single resample, which mirrors how the original
// dataset weights cluster contributions toward the unweighted observation
// mean — the estimator the candidate's `meanFinalScore` already reports.
//
// Edge cases (intentional):
// - 0 clusters → CI 0..0 (no information).
// - 1 cluster, 1 observation → CI collapses to that point.
// - 1 cluster, K>1 observations → CI collapses to the cluster mean. The
//   CI we report measures uncertainty over *different testCase inputs*,
//   not within-rep variance. With a single input you cannot estimate how
//   the candidate would behave on a different one no matter how many
//   reps you take, so a zero-width CI is the honest answer; the
//   alternative (i.i.d. resampling inside the cluster) would manufacture
//   a width that conflates rep noise with input-coverage uncertainty.
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
  // 95% percentile CI with EQUAL-COUNT tails. With N=10_000:
  //   lowIdx = floor(0.025·N) = 250  → 250 samples (indices 0..249) below
  //   highIdx = ceil(0.975·N) − 1 = 9749  → 250 samples (indices 9750..9999) above
  // Each tail holds exactly 2.5% of the resampled means, which is the
  // honest empirical 95% interval. Alternative quantile conventions
  // (e.g. (k+1)/N or k/(N-1) Hyndman-Fan #6/#7) would shift one tail by
  // a single sample and break this count-symmetry.
  const lowIdx = Math.floor(0.025 * BOOTSTRAP_SAMPLES);
  const highIdx = Math.min(
    BOOTSTRAP_SAMPLES - 1,
    Math.ceil(0.975 * BOOTSTRAP_SAMPLES) - 1,
  );
  return {
    low: samples[lowIdx] ?? 0,
    high: samples[highIdx] ?? 0,
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
