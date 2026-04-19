import type { BenchmarkResult } from "../../../../domain/entities/benchmark-result.js";
import {
  aggregateResults,
  candidateKey,
  computeAnalysis,
  computeParetoFrontier,
  pickWithPairedSignificanceTieBreak,
} from "../benchmark-analyzer.js";

let nextId = 1;
const row = (overrides: Partial<BenchmarkResult>): BenchmarkResult => ({
  id: String(nextId++),
  benchmarkId: "bm",
  testCaseId: "tc1",
  promptVersionId: "v1",
  solverModel: "gpt-4o",
  runIndex: 0,
  input: "",
  candidateOutput: "",
  judgeAccuracy: 5,
  judgeCoherence: 5,
  judgeInstruction: 5,
  judgeVotes: [],
  rawScore: 1,
  verbosityPenalty: 0,
  finalScore: 1,
  candidateInputTokens: 0,
  candidateOutputTokens: 0,
  candidateCostUsd: 0,
  judgeInputTokens: 0,
  judgeOutputTokens: 0,
  judgeCostUsd: 0,
  totalCostUsd: 0,
  latencyMs: 0,
  status: "completed",
  error: null,
  createdAt: new Date(),
  ...overrides,
});

describe("aggregateResults", () => {
  it("groups rows by (versionId, solverModel) and averages score", () => {
    const candidates = aggregateResults([
      row({ testCaseId: "a", finalScore: 1.0, totalCostUsd: 0.01 }),
      row({ testCaseId: "b", finalScore: 0.5, totalCostUsd: 0.02 }),
      row({ testCaseId: "a", solverModel: "gpt-4o-mini", finalScore: 0.9, totalCostUsd: 0.001 }),
    ]);

    expect(candidates).toHaveLength(2);
    const big = candidates.find((c) => c.solverModel === "gpt-4o");
    const small = candidates.find((c) => c.solverModel === "gpt-4o-mini");
    expect(big?.meanFinalScore).toBeCloseTo(0.75, 6);
    expect(big?.totalCostUsd).toBeCloseTo(0.03, 6);
    expect(big?.completedCount).toBe(2);
    expect(small?.meanFinalScore).toBeCloseTo(0.9, 6);
    expect(small?.totalCostUsd).toBeCloseTo(0.001, 6);
  });

  it("counts failed cells separately and preserves observed failure latency/cost", () => {
    const candidates = aggregateResults([
      row({ testCaseId: "a", finalScore: 0.8, totalCostUsd: 0.01 }),
      row({
        testCaseId: "b",
        status: "failed",
        finalScore: 0,
        totalCostUsd: 0.02,
        latencyMs: 150,
      }),
    ]);

    expect(candidates).toHaveLength(1);
    const c = candidates[0]!;
    expect(c.completedCount).toBe(1);
    expect(c.failedCount).toBe(1);
    expect(c.meanFinalScore).toBeCloseTo(0.4, 6);
    expect(c.meanAccuracy).toBeCloseTo(2.5, 6);
    expect(c.totalCostUsd).toBeCloseTo(0.03, 6);
    expect(c.meanLatencyMs).toBeCloseTo(75, 6);
  });

  it("does not treat failed rows with preserved latency as completed", () => {
    const [stats] = aggregateResults([
      row({
        testCaseId: "a",
        status: "failed",
        finalScore: 0,
        totalCostUsd: 0.02,
        latencyMs: 100,
      }),
    ]);

    expect(stats?.completedCount).toBe(0);
    expect(stats?.failedCount).toBe(1);
    expect(stats?.failureRate).toBe(1);
  });

  it("produces a deterministic 95% CI whose width shrinks as sample size grows", () => {
    const tight = aggregateResults(
      Array.from({ length: 20 }, (_, i) =>
        row({ testCaseId: `tc${i}`, finalScore: 0.8, runIndex: i }),
      ),
    );
    const wide = aggregateResults([
      row({ testCaseId: "a", runIndex: 0, finalScore: 0.2 }),
      row({ testCaseId: "a", runIndex: 1, finalScore: 1.0 }),
    ]);

    const tightWidth = tight[0]!.ci95High - tight[0]!.ci95Low;
    const wideWidth = wide[0]!.ci95High - wide[0]!.ci95Low;
    expect(tightWidth).toBeLessThan(wideWidth);

    const again = aggregateResults(
      Array.from({ length: 20 }, (_, i) =>
        row({ testCaseId: `tc${i}`, finalScore: 0.8, runIndex: i }),
      ),
    );
    expect(again[0]!.ci95Low).toBeCloseTo(tight[0]!.ci95Low, 10);
    expect(again[0]!.ci95High).toBeCloseTo(tight[0]!.ci95High, 10);
  });

  it("returns 100% consistency when all rows are identical", () => {
    const [stats] = aggregateResults([
      row({ testCaseId: "a", finalScore: 0.8 }),
      row({ testCaseId: "b", finalScore: 0.8 }),
      row({ testCaseId: "c", finalScore: 0.8 }),
    ]);
    expect(stats?.consistencyScore).toBeCloseTo(1, 10);
  });

  it("clamps consistency to 0 for worst-case alternation", () => {
    const [stats] = aggregateResults([
      row({ testCaseId: "a", finalScore: 1.0 }),
      row({ testCaseId: "b", finalScore: 0.0 }),
      row({ testCaseId: "c", finalScore: 1.0 }),
      row({ testCaseId: "d", finalScore: 0.0 }),
    ]);
    expect(stats?.consistencyScore).toBe(0);
  });
});

describe("computeParetoFrontier", () => {
  it("keeps only non-dominated candidates", () => {
    const candidates = aggregateResults([
      row({ promptVersionId: "vA", finalScore: 0.95, totalCostUsd: 1 }),
      row({ promptVersionId: "vB", finalScore: 0.85, totalCostUsd: 0.5 }),
      row({ promptVersionId: "vC", finalScore: 0.7, totalCostUsd: 0.05 }),
      row({ promptVersionId: "vD", finalScore: 0.8, totalCostUsd: 0.6 }),
    ]);

    const frontier = computeParetoFrontier(candidates);
    const keys = new Set(frontier.map((c) => c.promptVersionId));
    expect(keys.has("vA")).toBe(true);
    expect(keys.has("vB")).toBe(true);
    expect(keys.has("vC")).toBe(true);
    expect(keys.has("vD")).toBe(false);
  });

  it("excludes candidates with no completed cells", () => {
    const candidates = aggregateResults([
      row({ promptVersionId: "vA", finalScore: 0.9, totalCostUsd: 1 }),
      row({ promptVersionId: "vB", status: "failed", finalScore: 0, totalCostUsd: 0 }),
    ]);
    const frontier = computeParetoFrontier(candidates);
    expect(frontier).toHaveLength(1);
    expect(frontier[0]?.promptVersionId).toBe("vA");
  });

  it("excludes flaky candidates from Pareto view", () => {
    const frontier = computeParetoFrontier(
      aggregateResults([
        row({ promptVersionId: "vSteady", testCaseId: "a", finalScore: 0.8, totalCostUsd: 0.5 }),
        row({ promptVersionId: "vSteady", testCaseId: "b", finalScore: 0.82, totalCostUsd: 0.5 }),
        row({ promptVersionId: "vFlaky", testCaseId: "a", finalScore: 1, totalCostUsd: 0.1 }),
        row({ promptVersionId: "vFlaky", testCaseId: "b", status: "failed", finalScore: 0, totalCostUsd: 0 }),
      ]),
    );
    expect(frontier.map((candidate) => candidate.promptVersionId)).toEqual(["vSteady"]);
  });
});

describe("computeAnalysis", () => {
  it("recommends a high-composite candidate that clears the score floor", () => {
    const analysis = computeAnalysis([
      row({ promptVersionId: "vBig", finalScore: 1.0, totalCostUsd: 1.0 }),
      row({ promptVersionId: "vMid", finalScore: 0.85, totalCostUsd: 0.1 }),
      row({ promptVersionId: "vCheapBad", finalScore: 0.4, totalCostUsd: 0.001 }),
    ]);

    expect(analysis.baselineKey).toBeTruthy();
    expect(analysis.recommendedKey).toBeTruthy();
    expect(analysis.recommendedKey).not.toContain("vCheapBad");

    const recommendedPpd = analysis.ppd.find(
      (r) => r.candidateKey === analysis.recommendedKey,
    );
    expect(recommendedPpd).toBeDefined();
  });

  it("refuses to recommend a cheap-but-bad candidate", () => {
    const analysis = computeAnalysis([
      row({
        promptVersionId: "vBig",
        testCaseId: "a",
        finalScore: 0.95,
        judgeAccuracy: 5,
        judgeCoherence: 5,
        judgeInstruction: 5,
        totalCostUsd: 1.0,
      }),
      row({
        promptVersionId: "vCheapBad",
        testCaseId: "a",
        finalScore: 0.3,
        judgeAccuracy: 1,
        judgeCoherence: 1,
        judgeInstruction: 1,
        totalCostUsd: 0.001,
      }),
    ]);
    expect(analysis.recommendedKey).toContain("vBig");
  });

  it("returns empty PPD/ranking when there are no completed rows", () => {
    const analysis = computeAnalysis([
      row({ status: "failed", finalScore: 0, totalCostUsd: 0 }),
    ]);
    expect(analysis.ppd).toEqual([]);
    expect(analysis.ranking).toEqual([]);
    expect(analysis.recommendedKey).toBeNull();
    expect(analysis.categoryBreakdown).toHaveLength(1);
  });

  it("orders the ranking by composite score descending", () => {
    const analysis = computeAnalysis([
      row({ promptVersionId: "vA", judgeAccuracy: 5, judgeCoherence: 5, judgeInstruction: 5, finalScore: 1.0 }),
      row({ promptVersionId: "vB", judgeAccuracy: 3, judgeCoherence: 3, judgeInstruction: 3, finalScore: 0.5 }),
    ]);
    expect(analysis.ranking.map((r) => r.candidateKey)).toEqual([
      candidateKey({ promptVersionId: "vA", solverModel: "gpt-4o" }),
      candidateKey({ promptVersionId: "vB", solverModel: "gpt-4o" }),
    ]);
  });

  it("excludes unreliable candidates from the ranking", () => {
    const analysis = computeAnalysis([
      row({ promptVersionId: "vSteady", testCaseId: "a", finalScore: 0.8, totalCostUsd: 0.2 }),
      row({ promptVersionId: "vSteady", testCaseId: "b", finalScore: 0.82, totalCostUsd: 0.2 }),
      row({ promptVersionId: "vFlaky", testCaseId: "a", finalScore: 0.99, totalCostUsd: 0.05 }),
      row({ promptVersionId: "vFlaky", testCaseId: "b", status: "failed", finalScore: 0, totalCostUsd: 0 }),
    ]);

    expect(analysis.ranking.map((entry) => entry.candidateKey)).toEqual([
      candidateKey({ promptVersionId: "vSteady", solverModel: "gpt-4o" }),
    ]);
  });

  it("disqualifies a candidate whose failure rate exceeds the reliability gate", () => {
    // vFlaky has a perfect score on the one row that completed but half its
    // runs failed outright — it must not be recommended even with a top
    // composite.
    const analysis = computeAnalysis([
      row({ promptVersionId: "vFlaky", testCaseId: "a", finalScore: 1.0, totalCostUsd: 0.01 }),
      row({ promptVersionId: "vFlaky", testCaseId: "b", status: "failed", finalScore: 0, totalCostUsd: 0 }),
      row({ promptVersionId: "vSteady", testCaseId: "a", finalScore: 0.85, judgeAccuracy: 4, judgeCoherence: 4, judgeInstruction: 4, totalCostUsd: 0.02 }),
      row({ promptVersionId: "vSteady", testCaseId: "b", finalScore: 0.9, judgeAccuracy: 4, judgeCoherence: 4, judgeInstruction: 4, totalCostUsd: 0.02 }),
    ]);
    expect(analysis.recommendedKey).toContain("vSteady");
    const flaky = analysis.candidates.find((c) => c.promptVersionId === "vFlaky");
    expect(flaky?.failureRate).toBeCloseTo(0.5, 6);
    expect(analysis.paretoFrontierKeys.some((key) => key.includes("vFlaky"))).toBe(false);
    expect(analysis.ppd.some((row) => row.candidateKey.includes("vFlaky"))).toBe(false);
  });

  it("prefers the cheaper candidate when CIs overlap", () => {
    // Both candidates produce the same noisy finalScore distribution, so their
    // bootstrap CIs coincide — i.e. the composite gap is not statistically
    // separable. vExpensive has a higher composite due to better rubric means,
    // but the CI-overlap tie-break should still hand the recommendation to
    // vCheap.
    const finals = [0.5, 0.6, 0.7, 0.8, 0.9];
    const analysis = computeAnalysis([
      ...finals.map((f, i) =>
        row({
          promptVersionId: "vExpensive",
          testCaseId: `tc${i}`,
          finalScore: f,
          judgeAccuracy: 5,
          judgeCoherence: 5,
          judgeInstruction: 5,
          totalCostUsd: 1,
          latencyMs: 100,
        }),
      ),
      ...finals.map((f, i) =>
        row({
          promptVersionId: "vCheap",
          testCaseId: `tc${i}`,
          finalScore: f,
          judgeAccuracy: 3,
          judgeCoherence: 3,
          judgeInstruction: 3,
          totalCostUsd: 0.1,
          latencyMs: 100,
        }),
      ),
    ]);
    // Expensive has the higher raw composite...
    expect(analysis.ranking[0]?.candidateKey).toContain("vExpensive");
    // ...but the recommendation falls back to the cheaper candidate because
    // the CIs overlap.
    expect(analysis.recommendedKey).toContain("vCheap");
  });

  it("builds a real category breakdown from benchmark test case metadata", () => {
    const analysis = computeAnalysis(
      [
        row({
          promptVersionId: "vA",
          solverModel: "gpt-4o",
          testCaseId: "tc-typical",
          finalScore: 0.9,
          judgeAccuracy: 5,
          judgeCoherence: 4,
          judgeInstruction: 4,
          totalCostUsd: 0.02,
        }),
        row({
          promptVersionId: "vA",
          solverModel: "gpt-4o",
          testCaseId: "tc-manual",
          status: "failed",
          finalScore: 0,
          totalCostUsd: 0,
        }),
      ],
      {
        testCasesById: {
          "tc-typical": { category: "typical", source: "generated" },
          "tc-manual": { category: null, source: "manual" },
        },
      },
    );

    expect(analysis.categoryBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "typical",
          candidateKey: candidateKey({ promptVersionId: "vA", solverModel: "gpt-4o" }),
          meanFinalScore: 0.9,
          completedCount: 1,
          failedCount: 0,
        }),
        expect.objectContaining({
          category: "manual",
          candidateKey: candidateKey({ promptVersionId: "vA", solverModel: "gpt-4o" }),
          meanFinalScore: 0,
          completedCount: 0,
          failedCount: 1,
        }),
      ]),
    );
  });

  it("includes pairwise comparisons with significance and effect size", () => {
    const aScores = [0.85, 0.88, 0.92, 0.95, 0.90];
    const bScores = [0.45, 0.50, 0.55, 0.48, 0.52];
    const analysis = computeAnalysis([
      ...aScores.map((f, i) =>
        row({ promptVersionId: "vA", testCaseId: `tc${i}`, finalScore: f, totalCostUsd: 0.1 }),
      ),
      ...bScores.map((f, i) =>
        row({ promptVersionId: "vB", testCaseId: `tc${i}`, finalScore: f, totalCostUsd: 0.1 }),
      ),
    ]);
    expect(analysis.pairwiseComparisons).toHaveLength(1);
    const pair = analysis.pairwiseComparisons[0]!;
    expect(pair.candidateKeyA).toContain("vA");
    expect(pair.candidateKeyB).toContain("vB");
    expect(pair.meanDiff).toBeGreaterThan(0);
    expect(pair.isSignificant).toBe(true);
    expect(pair.effectSize).toBeGreaterThan(0);
    expect(["small", "medium", "large"]).toContain(pair.effectLabel);
  });

  it("computes variance decomposition", () => {
    const analysis = computeAnalysis([
      row({ promptVersionId: "vA", testCaseId: "tc1", runIndex: 0, finalScore: 0.9 }),
      row({ promptVersionId: "vA", testCaseId: "tc1", runIndex: 1, finalScore: 0.8 }),
      row({ promptVersionId: "vA", testCaseId: "tc2", runIndex: 0, finalScore: 0.5 }),
      row({ promptVersionId: "vA", testCaseId: "tc2", runIndex: 1, finalScore: 0.6 }),
    ]);
    expect(analysis.varianceDecomposition.totalVariance).toBeGreaterThan(0);
    expect(analysis.varianceDecomposition.withinRunVariance).toBeGreaterThanOrEqual(0);
    expect(analysis.varianceDecomposition.acrossTestCaseVariance).toBeGreaterThan(0);
  });

  it("provides suggested repetitions based on observed variance", () => {
    const analysis = computeAnalysis([
      ...Array.from({ length: 10 }, (_, i) =>
        row({ testCaseId: `tc${i}`, finalScore: 0.5 + Math.random() * 0.5 }),
      ),
    ]);
    expect(analysis.suggestedRepetitions).toBeGreaterThanOrEqual(3);
    expect(analysis.suggestedRepetitionsRationale).toContain("SD=");
  });

  it("reports exclusion reasons for unreliable candidates", () => {
    const analysis = computeAnalysis([
      row({ promptVersionId: "vSteady", testCaseId: "a", finalScore: 0.8, totalCostUsd: 0.5 }),
      row({ promptVersionId: "vSteady", testCaseId: "b", finalScore: 0.82, totalCostUsd: 0.5 }),
      row({ promptVersionId: "vFlaky", testCaseId: "a", finalScore: 1, totalCostUsd: 0.1 }),
      row({ promptVersionId: "vFlaky", testCaseId: "b", status: "failed", finalScore: 0, totalCostUsd: 0 }),
    ]);
    const flakyKey = candidateKey({ promptVersionId: "vFlaky", solverModel: "gpt-4o" });
    expect(analysis.exclusionReasons[flakyKey]).toContain("Failure rate");
  });

  it("uses a gentler consistency ceiling of 0.4", () => {
    const [stats] = aggregateResults([
      row({ testCaseId: "a", finalScore: 0.8 }),
      row({ testCaseId: "b", finalScore: 0.5 }),
    ]);
    expect(stats!.consistencyScore).toBeGreaterThan(0);
  });

  it("scans the full ranking for paired non-significant candidates instead of stopping early", () => {
    const topKey = candidateKey({ promptVersionId: "vTop", solverModel: "gpt-4o" });
    const middleKey = candidateKey({ promptVersionId: "vMiddle", solverModel: "gpt-4o" });
    const cheapKey = candidateKey({
      promptVersionId: "vCheapOverlap",
      solverModel: "gpt-4o",
    });

    const picked = pickWithPairedSignificanceTieBreak(
      [
        { candidateKey: topKey, compositeScore: 0.95 },
        { candidateKey: middleKey, compositeScore: 0.9 },
        { candidateKey: cheapKey, compositeScore: 0.8 },
      ],
      [
        {
          candidateKey: topKey,
          promptVersionId: "vTop",
          solverModel: "gpt-4o",
          meanAccuracy: 5,
          meanCoherence: 5,
          meanInstruction: 5,
          meanFinalScore: 0.9,
          ci95Low: 0.85,
          ci95High: 0.9,
          stderr: 0.01,
          consistencyScore: 1,
          meanLatencyMs: 100,
          meanCostUsd: 1.0,
          totalCostUsd: 5.0,
          completedCount: 5,
          failedCount: 0,
          failureRate: 0,
        },
        {
          candidateKey: middleKey,
          promptVersionId: "vMiddle",
          solverModel: "gpt-4o",
          meanAccuracy: 5,
          meanCoherence: 5,
          meanInstruction: 5,
          meanFinalScore: 0.4,
          ci95Low: 0.1,
          ci95High: 0.2,
          stderr: 0.02,
          consistencyScore: 1,
          meanLatencyMs: 100,
          meanCostUsd: 0.7,
          totalCostUsd: 3.5,
          completedCount: 5,
          failedCount: 0,
          failureRate: 0,
        },
        {
          candidateKey: cheapKey,
          promptVersionId: "vCheapOverlap",
          solverModel: "gpt-4o",
          meanAccuracy: 2,
          meanCoherence: 2,
          meanInstruction: 2,
          meanFinalScore: 0.88,
          ci95Low: 0.87,
          ci95High: 0.89,
          stderr: 0.01,
          consistencyScore: 1,
          meanLatencyMs: 100,
          meanCostUsd: 0.2,
          totalCostUsd: 1.0,
          completedCount: 5,
          failedCount: 0,
          failureRate: 0,
        },
      ],
      [
        row({ promptVersionId: "vTop", testCaseId: "a", runIndex: 0, finalScore: 0.8 }),
        row({ promptVersionId: "vTop", testCaseId: "b", runIndex: 0, finalScore: 0.9 }),
        row({ promptVersionId: "vMiddle", testCaseId: "a", runIndex: 0, finalScore: 0.1 }),
        row({ promptVersionId: "vMiddle", testCaseId: "b", runIndex: 0, finalScore: 0.2 }),
        row({
          promptVersionId: "vCheapOverlap",
          testCaseId: "a",
          runIndex: 0,
          finalScore: 0.81,
        }),
        row({
          promptVersionId: "vCheapOverlap",
          testCaseId: "b",
          runIndex: 0,
          finalScore: 0.89,
        }),
      ],
    );

    expect(picked?.rank.candidateKey).toBe(cheapKey);
  });
});
