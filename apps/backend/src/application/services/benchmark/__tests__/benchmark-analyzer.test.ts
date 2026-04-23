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
  solverModel: "llama-3.3-70b-versatile",
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
  exactMatch: null,
  fuzzyMatchScore: null,
  candidateInputTokens: 0,
  candidateOutputTokens: 0,
  candidateCostUsd: 0,
  judgeInputTokens: 0,
  judgeOutputTokens: 0,
  judgeCostUsd: 0,
  totalCostUsd: 0,
  judgeFailureCount: 0,
  latencyMs: 0,
  status: "completed",
  failureKind: null,
  error: null,
  createdAt: new Date(),
  ...overrides,
});

describe("aggregateResults", () => {
  it("groups rows by (versionId, solverModel) and averages score", () => {
    const candidates = aggregateResults([
      row({ testCaseId: "a", finalScore: 1.0, totalCostUsd: 0.01 }),
      row({ testCaseId: "b", finalScore: 0.5, totalCostUsd: 0.02 }),
      row({ testCaseId: "a", solverModel: "openai/gpt-oss-20b", finalScore: 0.9, totalCostUsd: 0.001 }),
    ]);

    expect(candidates).toHaveLength(2);
    const big = candidates.find((c) => c.solverModel === "llama-3.3-70b-versatile");
    const small = candidates.find((c) => c.solverModel === "openai/gpt-oss-20b");
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
        failureKind: "solver_error",
        finalScore: 0,
        totalCostUsd: 0.02,
        latencyMs: 150,
      }),
    ]);

    expect(candidates).toHaveLength(1);
    const c = candidates[0]!;
    expect(c.completedCount).toBe(1);
    expect(c.failedCount).toBe(1);
    expect(c.meanFinalScore).toBeCloseTo(0.8, 6);
    expect(c.meanAccuracy).toBeCloseTo(5, 6);
    expect(c.totalCostUsd).toBeCloseTo(0.03, 6);
    expect(c.meanLatencyMs).toBeCloseTo(75, 6);
  });

  it("does not treat failed rows with preserved latency as completed", () => {
    const [stats] = aggregateResults([
      row({
        testCaseId: "a",
        status: "failed",
        failureKind: "timeout",
        finalScore: 0,
        totalCostUsd: 0.02,
        latencyMs: 100,
      }),
    ]);

    expect(stats?.completedCount).toBe(0);
    expect(stats?.failedCount).toBe(1);
    expect(stats?.failureRate).toBe(1);
    expect(stats?.operationalIssueRate).toBe(1);
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
      row({
        promptVersionId: "vB",
        status: "failed",
        failureKind: "solver_error",
        finalScore: 0,
        totalCostUsd: 0,
      }),
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
        row({
          promptVersionId: "vFlaky",
          testCaseId: "b",
          status: "failed",
          failureKind: "solver_error",
          finalScore: 0,
          totalCostUsd: 0,
        }),
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
      row({ status: "failed", failureKind: "solver_error", finalScore: 0, totalCostUsd: 0 }),
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
      candidateKey({ promptVersionId: "vA", solverModel: "llama-3.3-70b-versatile" }),
      candidateKey({ promptVersionId: "vB", solverModel: "llama-3.3-70b-versatile" }),
    ]);
  });

  it("excludes unreliable candidates from the ranking", () => {
    const analysis = computeAnalysis([
      row({ promptVersionId: "vSteady", testCaseId: "a", finalScore: 0.8, totalCostUsd: 0.2 }),
      row({ promptVersionId: "vSteady", testCaseId: "b", finalScore: 0.82, totalCostUsd: 0.2 }),
      row({ promptVersionId: "vFlaky", testCaseId: "a", finalScore: 0.99, totalCostUsd: 0.05 }),
      row({
        promptVersionId: "vFlaky",
        testCaseId: "b",
        status: "failed",
        failureKind: "solver_error",
        finalScore: 0,
        totalCostUsd: 0,
      }),
    ]);

    expect(analysis.ranking.map((entry) => entry.candidateKey)).toEqual([
      candidateKey({ promptVersionId: "vSteady", solverModel: "llama-3.3-70b-versatile" }),
    ]);
  });

  it("disqualifies a candidate whose failure rate exceeds the reliability gate", () => {
    // vFlaky has a perfect score on the one row that completed but half its
    // runs failed outright — it must not be recommended even with a top
    // composite.
    const analysis = computeAnalysis([
      row({ promptVersionId: "vFlaky", testCaseId: "a", finalScore: 1.0, totalCostUsd: 0.01 }),
      row({
        promptVersionId: "vFlaky",
        testCaseId: "b",
        status: "failed",
        failureKind: "solver_error",
        finalScore: 0,
        totalCostUsd: 0,
      }),
      row({ promptVersionId: "vSteady", testCaseId: "a", finalScore: 0.85, judgeAccuracy: 4, judgeCoherence: 4, judgeInstruction: 4, totalCostUsd: 0.02 }),
      row({ promptVersionId: "vSteady", testCaseId: "b", finalScore: 0.9, judgeAccuracy: 4, judgeCoherence: 4, judgeInstruction: 4, totalCostUsd: 0.02 }),
    ]);
    expect(analysis.recommendedKey).toContain("vSteady");
    const flaky = analysis.candidates.find((c) => c.promptVersionId === "vFlaky");
    expect(flaky?.failureRate).toBeCloseTo(0.5, 6);
    expect(flaky?.operationalIssueRate).toBeCloseTo(0.5, 6);
    expect(analysis.paretoFrontierKeys.some((key) => key.includes("vFlaky"))).toBe(false);
    expect(analysis.ppd.some((row) => row.candidateKey.includes("vFlaky"))).toBe(false);
  });

  it("excludes budget-truncated candidates from ranking when coverage is unequal", () => {
    const analysis = computeAnalysis([
      row({ promptVersionId: "vBudgeted", testCaseId: "a", finalScore: 0.9, totalCostUsd: 0.05 }),
      row({
        promptVersionId: "vBudgeted",
        testCaseId: "b",
        status: "failed",
        failureKind: "budget_exceeded",
        totalCostUsd: 0,
      }),
      row({ promptVersionId: "vSteady", testCaseId: "a", finalScore: 0.85, totalCostUsd: 0.08 }),
      row({ promptVersionId: "vSteady", testCaseId: "b", finalScore: 0.84, totalCostUsd: 0.08 }),
    ]);

    const budgeted = analysis.candidates.find((c) => c.promptVersionId === "vBudgeted");
    expect(budgeted?.failureRate).toBeCloseTo(0.5, 6);
    expect(budgeted?.operationalIssueRate).toBe(0);
    expect(analysis.ranking.some((entry) => entry.candidateKey.includes("vBudgeted"))).toBe(false);
    expect(analysis.recommendedKey).toBeNull();
  });

  it("suppresses recommendation when reliable candidates have unequal completed coverage", () => {
    const analysis = computeAnalysis([
      row({ promptVersionId: "vA", testCaseId: "a", runIndex: 0, finalScore: 0.91 }),
      row({ promptVersionId: "vA", testCaseId: "b", runIndex: 0, finalScore: 0.9 }),
      row({ promptVersionId: "vB", testCaseId: "a", runIndex: 0, finalScore: 0.89 }),
    ]);

    expect(analysis.recommendedKey).toBeNull();
    expect(analysis.exclusionReasons).toEqual(
      expect.objectContaining({
        [candidateKey({ promptVersionId: "vB", solverModel: "llama-3.3-70b-versatile" })]:
          expect.stringContaining("Completed-sample coverage differs"),
        }),
    );
  });

  it("suppresses pairwise comparisons when completed coverage is unequal", () => {
    const analysis = computeAnalysis([
      row({ promptVersionId: "vA", testCaseId: "a", runIndex: 0, finalScore: 0.91 }),
      row({ promptVersionId: "vA", testCaseId: "b", runIndex: 0, finalScore: 0.9 }),
      row({ promptVersionId: "vB", testCaseId: "a", runIndex: 0, finalScore: 0.89 }),
    ]);

    expect(analysis.pairwiseComparisons).toEqual([]);
  });

  it("derives the score floor from reliable candidates when available", () => {
    const analysis = computeAnalysis([
      row({ promptVersionId: "vReliable", testCaseId: "a", finalScore: 0.84 }),
      row({ promptVersionId: "vReliable", testCaseId: "b", finalScore: 0.85 }),
      row({
        promptVersionId: "vUnreliableHigh",
        testCaseId: "a",
        finalScore: 1.0,
      }),
      row({
        promptVersionId: "vUnreliableHigh",
        testCaseId: "b",
        finalScore: 1.0,
        judgeVotes: [
          { model: "judge-a", accuracy: 5, coherence: 5, instruction: 5, reasoning: "", inputTokens: 1, outputTokens: 1, costUsd: 0 },
        ],
        judgeFailureCount: 1,
      }),
    ]);

    expect(analysis.recommendedKey).toContain("vReliable");
  });

  it("treats partial judge outages as operational issues for reliability", () => {
    const analysis = computeAnalysis([
      row({
        promptVersionId: "vPartial",
        testCaseId: "a",
        finalScore: 0.95,
        judgeVotes: [
          { model: "judge-a", accuracy: 5, coherence: 5, instruction: 5, reasoning: "", inputTokens: 1, outputTokens: 1, costUsd: 0 },
          { model: "judge-b", accuracy: 5, coherence: 5, instruction: 5, reasoning: "", inputTokens: 1, outputTokens: 1, costUsd: 0 },
        ],
        judgeFailureCount: 1,
      }),
      row({
        promptVersionId: "vPartial",
        testCaseId: "b",
        finalScore: 0.94,
        judgeVotes: [
          { model: "judge-a", accuracy: 5, coherence: 5, instruction: 5, reasoning: "", inputTokens: 1, outputTokens: 1, costUsd: 0 },
          { model: "judge-b", accuracy: 5, coherence: 5, instruction: 5, reasoning: "", inputTokens: 1, outputTokens: 1, costUsd: 0 },
        ],
        judgeFailureCount: 1,
      }),
      row({ promptVersionId: "vClean", testCaseId: "a", finalScore: 0.9 }),
      row({ promptVersionId: "vClean", testCaseId: "b", finalScore: 0.91 }),
    ]);

    const partial = analysis.candidates.find((c) => c.promptVersionId === "vPartial");
    expect(partial?.failureRate).toBe(0);
    expect(partial?.operationalIssueRate).toBeCloseTo(1 / 3, 6);
    expect(analysis.ranking.some((entry) => entry.candidateKey.includes("vPartial"))).toBe(false);
  });

  it("applies a soft ranking penalty before the reliability gate is hit", () => {
    const analysis = computeAnalysis([
      ...Array.from({ length: 10 }, (_, i) =>
        row({ promptVersionId: "vClean", testCaseId: `clean-${i}`, finalScore: 0.9 }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        row({
          promptVersionId: "vMostlyClean",
          testCaseId: `mostly-clean-${i}`,
          finalScore: 0.9,
          judgeVotes:
            i === 0
              ? [
                  { model: "judge-a", accuracy: 5, coherence: 5, instruction: 5, reasoning: "", inputTokens: 1, outputTokens: 1, costUsd: 0 },
                  { model: "judge-b", accuracy: 5, coherence: 5, instruction: 5, reasoning: "", inputTokens: 1, outputTokens: 1, costUsd: 0 },
                ]
              : [],
          judgeFailureCount: i === 0 ? 1 : 0,
        }),
      ),
    ]);

    expect(analysis.ranking[0]?.candidateKey).toContain("vClean");
    const mostlyClean = analysis.candidates.find((c) => c.promptVersionId === "vMostlyClean");
    expect(mostlyClean?.operationalIssueRate).toBeCloseTo(1 / 30, 6);
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
          solverModel: "llama-3.3-70b-versatile",
          testCaseId: "tc-typical",
          finalScore: 0.9,
          judgeAccuracy: 5,
          judgeCoherence: 4,
          judgeInstruction: 4,
          totalCostUsd: 0.02,
        }),
        row({
          promptVersionId: "vA",
          solverModel: "llama-3.3-70b-versatile",
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
          candidateKey: candidateKey({ promptVersionId: "vA", solverModel: "llama-3.3-70b-versatile" }),
          meanFinalScore: 0.9,
          completedCount: 1,
          failedCount: 0,
        }),
        expect.objectContaining({
          category: "manual",
          candidateKey: candidateKey({ promptVersionId: "vA", solverModel: "llama-3.3-70b-versatile" }),
          meanFinalScore: 0,
          completedCount: 0,
          failedCount: 1,
        }),
      ]),
    );
  });

  it("computes judge agreement and suppresses relative severity with only two judges", () => {
    const analysis = computeAnalysis([
      row({
        testCaseId: "a",
        judgeVotes: [
          { model: "judge-a", accuracy: 5, coherence: 4, instruction: 4, reasoning: "", inputTokens: 1, outputTokens: 1, costUsd: 0 },
          { model: "judge-b", accuracy: 3, coherence: 4, instruction: 4, reasoning: "", inputTokens: 1, outputTokens: 1, costUsd: 0 },
        ],
      }),
      row({
        testCaseId: "b",
        judgeVotes: [
          { model: "judge-a", accuracy: 5, coherence: 5, instruction: 5, reasoning: "", inputTokens: 1, outputTokens: 1, costUsd: 0 },
          { model: "judge-b", accuracy: 4, coherence: 5, instruction: 5, reasoning: "", inputTokens: 1, outputTokens: 1, costUsd: 0 },
        ],
      }),
    ]);

    expect(analysis.judgeAgreement).toHaveLength(1);
    expect(analysis.judgeAgreement[0]?.judgeModelA).toBe("judge-a");
    expect(analysis.judgeBias).toEqual([]);
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
      row({
        promptVersionId: "vFlaky",
        testCaseId: "b",
        status: "failed",
        failureKind: "solver_error",
        finalScore: 0,
        totalCostUsd: 0,
      }),
    ]);
    const flakyKey = candidateKey({ promptVersionId: "vFlaky", solverModel: "llama-3.3-70b-versatile" });
    expect(analysis.exclusionReasons[flakyKey]).toContain("Operational issue rate");
  });

  it("uses a gentler consistency ceiling of 0.4", () => {
    const [stats] = aggregateResults([
      row({ testCaseId: "a", finalScore: 0.8 }),
      row({ testCaseId: "b", finalScore: 0.5 }),
    ]);
    expect(stats!.consistencyScore).toBeGreaterThan(0);
  });

  it("scans the full ranking for paired non-significant candidates instead of stopping early", () => {
    const topKey = candidateKey({ promptVersionId: "vTop", solverModel: "llama-3.3-70b-versatile" });
    const middleKey = candidateKey({ promptVersionId: "vMiddle", solverModel: "llama-3.3-70b-versatile" });
    const cheapKey = candidateKey({
      promptVersionId: "vCheapOverlap",
      solverModel: "llama-3.3-70b-versatile",
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
          solverModel: "llama-3.3-70b-versatile",
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
          operationalIssueCount: 0,
          operationalIssueRate: 0,
        },
        {
          candidateKey: middleKey,
          promptVersionId: "vMiddle",
          solverModel: "llama-3.3-70b-versatile",
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
          operationalIssueCount: 0,
          operationalIssueRate: 0,
        },
        {
          candidateKey: cheapKey,
          promptVersionId: "vCheapOverlap",
          solverModel: "llama-3.3-70b-versatile",
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
          operationalIssueCount: 0,
          operationalIssueRate: 0,
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
