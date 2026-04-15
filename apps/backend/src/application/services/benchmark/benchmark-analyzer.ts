import type { BenchmarkResult } from "../../../domain/entities/benchmark-result.js";
import { PPD } from "../../../domain/value-objects/ppd.js";

// Aggregates raw BenchmarkResult rows into the (promptVersion × solver × mode)
// candidates that drive the PPD dashboard. A "candidate" is the unit a user
// would actually deploy: a specific prompt version interpreted in one mode,
// served by one solver model. The runner records one row per (cell × test
// case); this collapses across test cases to mean accuracy + total cost.
//
// The Pareto frontier highlights candidates that no other candidate strictly
// dominates on both axes (higher accuracy AND lower cost). The "golden
// quadrant" recommendation is the highest-PPD candidate that also clears a
// minimum accuracy floor — pure PPD can otherwise reward a cheap-but-bad row.

export interface BenchmarkCandidate {
  promptVersionId: string;
  solverModel: string;
  // Mean over completed test cases for this candidate.
  meanFinalScore: number;
  // Sum of solver + judge cost over the same completed cases.
  totalCostUsd: number;
  completedCount: number;
  failedCount: number;
}

export interface PPDRow {
  candidate: BenchmarkCandidate;
  ppd: number;
  isMoreEfficient: boolean;
}

export interface BenchmarkAnalysis {
  candidates: BenchmarkCandidate[];
  paretoFrontierKeys: string[];
  baselineKey: string | null;
  ppd: PPDRow[];
  recommendedKey: string | null;
}

export interface AnalyzerOptions {
  // Minimum mean final score the recommended candidate must clear. Defaults to
  // 80% of the best observed score so a 1-cent garbage row does not "win".
  minScoreFraction?: number;
}

export const candidateKey = (c: Pick<
  BenchmarkCandidate,
  "promptVersionId" | "solverModel"
>): string => `${c.promptVersionId}::${c.solverModel}`;

export const aggregateResults = (results: BenchmarkResult[]): BenchmarkCandidate[] => {
  type Acc = {
    candidate: BenchmarkCandidate;
    sumFinalScore: number;
  };
  const buckets = new Map<string, Acc>();

  for (const r of results) {
    const key = candidateKey(r);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        candidate: {
          promptVersionId: r.promptVersionId,
          solverModel: r.solverModel,
          meanFinalScore: 0,
          totalCostUsd: 0,
          completedCount: 0,
          failedCount: 0,
        },
        sumFinalScore: 0,
      };
      buckets.set(key, bucket);
    }

    if (r.status === "failed") {
      bucket.candidate.failedCount += 1;
      continue;
    }

    bucket.sumFinalScore += r.finalScore;
    bucket.candidate.totalCostUsd += r.totalCostUsd;
    bucket.candidate.completedCount += 1;
  }

  const out: BenchmarkCandidate[] = [];
  for (const bucket of buckets.values()) {
    bucket.candidate.meanFinalScore =
      bucket.candidate.completedCount === 0
        ? 0
        : bucket.sumFinalScore / bucket.candidate.completedCount;
    out.push(bucket.candidate);
  }
  return out;
};

// Pareto frontier on (maximize meanFinalScore, minimize totalCostUsd).
// Candidates with zero completed cells are excluded from the frontier (they
// represent a fully-failed row and have no meaningful score).
export const computeParetoFrontier = (
  candidates: BenchmarkCandidate[],
): BenchmarkCandidate[] => {
  const eligible = candidates.filter((c) => c.completedCount > 0);
  return eligible.filter((candidate) => {
    return !eligible.some(
      (other) =>
        other !== candidate &&
        other.meanFinalScore >= candidate.meanFinalScore &&
        other.totalCostUsd <= candidate.totalCostUsd &&
        (other.meanFinalScore > candidate.meanFinalScore ||
          other.totalCostUsd < candidate.totalCostUsd),
    );
  });
};

// Baseline = the most expensive candidate among those clearing the score
// floor. The paper's framing is "is the new BRAID setup cheaper than what we
// already trust?"; the trusted setup is usually the strongest, priciest
// classical option. If nothing is eligible, fall back to the row with the
// highest mean score regardless of cost.
const pickBaseline = (
  candidates: BenchmarkCandidate[],
  scoreFloor: number,
): BenchmarkCandidate | null => {
  const eligible = candidates.filter(
    (c) => c.completedCount > 0 && c.meanFinalScore >= scoreFloor,
  );
  if (eligible.length === 0) {
    const best = candidates
      .filter((c) => c.completedCount > 0)
      .sort((a, b) => b.meanFinalScore - a.meanFinalScore)[0];
    return best ?? null;
  }
  return eligible.sort((a, b) => b.totalCostUsd - a.totalCostUsd)[0] ?? null;
};

export const analyzeBenchmark = (
  results: BenchmarkResult[],
  options: AnalyzerOptions = {},
): BenchmarkAnalysis => {
  const candidates = aggregateResults(results);
  const paretoFrontier = computeParetoFrontier(candidates);
  const paretoFrontierKeys = paretoFrontier.map(candidateKey);

  const completed = candidates.filter((c) => c.completedCount > 0);
  if (completed.length === 0) {
    return {
      candidates,
      paretoFrontierKeys,
      baselineKey: null,
      ppd: [],
      recommendedKey: null,
    };
  }

  const bestScore = Math.max(...completed.map((c) => c.meanFinalScore));
  const minScoreFraction = options.minScoreFraction ?? 0.8;
  const scoreFloor = bestScore * minScoreFraction;

  const baseline = pickBaseline(candidates, scoreFloor);
  if (!baseline || baseline.totalCostUsd <= 0 || baseline.meanFinalScore <= 0) {
    return {
      candidates,
      paretoFrontierKeys,
      baselineKey: baseline ? candidateKey(baseline) : null,
      ppd: [],
      recommendedKey: null,
    };
  }

  const baselineKey = candidateKey(baseline);
  const ppd: PPDRow[] = completed.map((candidate) => {
    const score = PPD.compute(
      { accuracy: candidate.meanFinalScore, costUsd: candidate.totalCostUsd },
      { accuracy: baseline.meanFinalScore, costUsd: baseline.totalCostUsd },
    );
    return {
      candidate,
      ppd: score.value,
      isMoreEfficient: score.isMoreEfficient,
    };
  });

  const recommended = ppd
    .filter((row) => row.candidate.meanFinalScore >= scoreFloor)
    .sort((a, b) => b.ppd - a.ppd)[0];

  return {
    candidates,
    paretoFrontierKeys,
    baselineKey,
    ppd,
    recommendedKey: recommended ? candidateKey(recommended.candidate) : null,
  };
};
