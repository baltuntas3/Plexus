import type {
  BenchmarkResult,
  JudgeVote,
} from "../../../../domain/entities/benchmark-result.js";
import {
  aggregateResults,
  candidateKey,
  computeAnalysis,
  computeParetoFrontier,
  pickWithPairedSignificanceTieBreak,
} from "../benchmark-analyzer.js";

// Test rows used to drive the analyzer must produce a target `finalScore`
// (in [0,1]) via judgeVotes, since the row no longer carries the aggregate
// directly. The conversion mirrors `judgeRubricAggregate`'s contract:
// `finalScore = ((rubricMean - 1) / 4)` ⇒ `rubricMean = finalScore * 4 + 1`.
const voteForScore = (finalScore: number): JudgeVote => {
  const rubric = finalScore * 4 + 1;
  return {
    model: "judge-1",
    accuracy: rubric,
    coherence: rubric,
    instruction: rubric,
    reasoning: "",
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  };
};

interface RowOverrides extends Partial<Omit<BenchmarkResult, "judgeVotes">> {
  finalScore?: number;
  judgeAccuracy?: number;
  judgeCoherence?: number;
  judgeInstruction?: number;
  judgeVotes?: JudgeVote[];
}

let nextId = 1;
const row = (overrides: RowOverrides = {}): BenchmarkResult => {
  const {
    finalScore,
    judgeAccuracy,
    judgeCoherence,
    judgeInstruction,
    judgeVotes,
    ...rest
  } = overrides;
  let votes: JudgeVote[];
  if (judgeVotes !== undefined) {
    votes = judgeVotes;
  } else if (
    judgeAccuracy !== undefined ||
    judgeCoherence !== undefined ||
    judgeInstruction !== undefined
  ) {
    votes = [
      {
        model: "judge-1",
        accuracy: judgeAccuracy ?? 5,
        coherence: judgeCoherence ?? 5,
        instruction: judgeInstruction ?? 5,
        reasoning: "",
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      },
    ];
  } else {
    votes = [voteForScore(finalScore ?? 1)];
  }
  return {
    id: String(nextId++),
    benchmarkId: "bm",
    testCaseId: "tc1",
    promptVersionId: "v1",
    solverModel: "llama-3.3-70b-versatile",
    runIndex: 0,
    candidateOutput: "",
    judgeVotes: votes,
    candidateInputTokens: 0,
    candidateOutputTokens: 0,
    candidateCostUsd: 0,
    judgeInputTokens: 0,
    judgeOutputTokens: 0,
    judgeCostUsd: 0,
	    totalCostUsd: 0,
	    judgeFailureCount: 0,
	    solverLatencyMs: rest.solverLatencyMs ?? rest.latencyMs ?? 0,
	    latencyMs: 0,
    status: "completed",
    failureKind: null,
    error: null,
    createdAt: new Date(),
    ...rest,
  };
};

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
    // Rubric is derived from `judgeVotes`; voteForScore(0.8) produces a
    // uniform rubric of 4.2 across all axes ((4.2 - 1) / 4 = 0.8).
    expect(c.meanAccuracy).toBeCloseTo(4.2, 6);
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

  it("produces a deterministic 95% CI that widens with score spread across testCases", () => {
    // Tight: 20 testCases with low spread around 0.8 — cluster bootstrap on
    // testCases gives a narrow CI because resampling testCases varies the
    // mean only slightly.
    const tight = aggregateResults(
      Array.from({ length: 20 }, (_, i) =>
        row({
          testCaseId: `tc${i}`,
          finalScore: 0.8 + (i % 2 === 0 ? 0.01 : -0.01),
          runIndex: 0,
        }),
      ),
    );
    // Wide: 4 testCases with large spread — fewer clusters AND much higher
    // between-cluster variance, so the bootstrap CI is materially wider.
    const wide = aggregateResults([
      row({ testCaseId: "a", runIndex: 0, finalScore: 0.0 }),
      row({ testCaseId: "b", runIndex: 0, finalScore: 0.4 }),
      row({ testCaseId: "c", runIndex: 0, finalScore: 0.6 }),
      row({ testCaseId: "d", runIndex: 0, finalScore: 1.0 }),
    ]);

    const tightWidth = tight[0]!.ci95High - tight[0]!.ci95Low;
    const wideWidth = wide[0]!.ci95High - wide[0]!.ci95Low;
    expect(tightWidth).toBeLessThan(wideWidth);

    const again = aggregateResults(
      Array.from({ length: 20 }, (_, i) =>
        row({
          testCaseId: `tc${i}`,
          finalScore: 0.8 + (i % 2 === 0 ? 0.01 : -0.01),
          runIndex: 0,
        }),
      ),
    );
    expect(again[0]!.ci95Low).toBeCloseTo(tight[0]!.ci95Low, 10);
    expect(again[0]!.ci95High).toBeCloseTo(tight[0]!.ci95High, 10);
  });

  it("keeps each candidate CI independent from result insertion order", () => {
    const candidateA = Array.from({ length: 6 }, (_, i) =>
      row({
        promptVersionId: "version-a",
        solverModel: "model-a",
        testCaseId: `tc${i}`,
        finalScore: i % 2 === 0 ? 0.7 : 0.9,
      }),
    );
    const candidateB = Array.from({ length: 6 }, (_, i) =>
      row({
        promptVersionId: "version-b",
        solverModel: "model-b",
        testCaseId: `tc${i}`,
        finalScore: i % 2 === 0 ? 0.2 : 0.6,
      }),
    );

    const first = aggregateResults([...candidateA, ...candidateB]);
    const reversed = aggregateResults([...candidateB, ...candidateA]);

    for (const candidate of first) {
      const same = reversed.find((c) => c.candidateKey === candidate.candidateKey);
      expect(same?.ci95Low).toBeCloseTo(candidate.ci95Low, 10);
      expect(same?.ci95High).toBeCloseTo(candidate.ci95High, 10);
    }
  });

  it("collapses CI to a point when only one testCase cluster exists", () => {
    // With a single testCase cluster, the cluster bootstrap can never draw
    // anything but that cluster — the CI is a point estimate. This is the
    // honest behaviour: with one input, you cannot estimate how the
    // candidate would do on different inputs, no matter how many reps you
    // collect. (Standard i.i.d. bootstrap would lie and produce a width.)
    const [stats] = aggregateResults([
      row({ testCaseId: "only", runIndex: 0, finalScore: 0.2 }),
      row({ testCaseId: "only", runIndex: 1, finalScore: 1.0 }),
    ]);
    expect(stats?.ci95High).toBe(stats?.ci95Low);
    expect(stats?.meanFinalScore).toBeCloseTo(0.6, 10);
  });

  it("returns 100% consistency when all rows are identical", () => {
    const [stats] = aggregateResults([
      row({ testCaseId: "a", finalScore: 0.8 }),
      row({ testCaseId: "b", finalScore: 0.8 }),
      row({ testCaseId: "c", finalScore: 0.8 }),
    ]);
    expect(stats?.consistencyScore).toBeCloseTo(1, 10);
  });

  it("does not penalize consistency for stable score differences across testCases", () => {
    const [stats] = aggregateResults([
      row({ testCaseId: "easy", runIndex: 0, finalScore: 0.95 }),
      row({ testCaseId: "easy", runIndex: 1, finalScore: 0.95 }),
      row({ testCaseId: "hard", runIndex: 0, finalScore: 0.35 }),
      row({ testCaseId: "hard", runIndex: 1, finalScore: 0.35 }),
    ]);
    expect(stats?.consistencyScore).toBeCloseTo(1, 10);
  });

  it("clamps consistency to 0 for worst-case within-testCase alternation", () => {
    const [stats] = aggregateResults([
      row({ testCaseId: "a", runIndex: 0, finalScore: 1.0 }),
      row({ testCaseId: "a", runIndex: 1, finalScore: 0.0 }),
      row({ testCaseId: "b", runIndex: 0, finalScore: 1.0 }),
      row({ testCaseId: "b", runIndex: 1, finalScore: 0.0 }),
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

  it("recommends from the largest comparable-coverage cohort and excludes off-cohort candidates from ranking", () => {
    // vA covers (a, b); vB covers only (a). The largest cohort is vA's,
    // so vB is excluded from ranking/PPD/Pareto. The recommendation is
    // still produced from the cohort we *can* compare honestly.
    const analysis = computeAnalysis([
      row({ promptVersionId: "vA", testCaseId: "a", runIndex: 0, finalScore: 0.91 }),
      row({ promptVersionId: "vA", testCaseId: "b", runIndex: 0, finalScore: 0.9 }),
      row({ promptVersionId: "vB", testCaseId: "a", runIndex: 0, finalScore: 0.89 }),
    ]);

    expect(analysis.recommendedKey).toContain("vA");
    expect(
      analysis.ranking.some((entry) =>
        entry.candidateKey.includes("vB"),
      ),
    ).toBe(false);
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

  it("prefers the cheaper candidate when paired-diff CI contains zero", () => {
    // Two candidates with byte-identical finalScores per cell — the paired
    // bootstrap diff CI is [0, 0], trivially "not statistically separable".
    // With identical quality, vCheap also wins composite outright on cost,
    // so the recommendation falls to vCheap regardless of which path the
    // tie-break takes. (Direct unit coverage for the tie-break helper lives
    // in the `pickWithPairedSignificanceTieBreak` describe block below.)
    const finals = [0.5, 0.6, 0.7, 0.8, 0.9];
    const analysis = computeAnalysis([
      ...finals.map((f, i) =>
        row({
          promptVersionId: "vExpensive",
          testCaseId: `tc${i}`,
          finalScore: f,
          totalCostUsd: 1,
          latencyMs: 100,
        }),
      ),
      ...finals.map((f, i) =>
        row({
          promptVersionId: "vCheap",
          testCaseId: `tc${i}`,
          finalScore: f,
          totalCostUsd: 0.1,
          latencyMs: 100,
        }),
      ),
    ]);
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
          totalCostUsd: 0.02,
        }),
        row({
          promptVersionId: "vA",
          solverModel: "llama-3.3-70b-versatile",
          testCaseId: "tc-manual",
          status: "failed",
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
          // `meanFinalScore` is derived from rubric: voteForScore(0.9)
          // produces a uniform 4.6 across axes, ((4.6 - 1) / 4) ≈ 0.9 with
          // floating-point noise, so use a tolerance match.
          meanFinalScore: expect.closeTo(0.9, 6),
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

  it("computes judge agreement when at least two judges score a row", () => {
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
    expect(analysis.judgeAgreement[0]?.sharedVotes).toBe(2);
  });

  it("uses a gentler consistency ceiling of 0.4 for within-testCase variance", () => {
    const [stats] = aggregateResults([
      row({ testCaseId: "a", runIndex: 0, finalScore: 0.8 }),
      row({ testCaseId: "a", runIndex: 1, finalScore: 0.5 }),
    ]);
    expect(stats!.consistencyScore).toBeGreaterThan(0);
  });

  it("builds an ensemble judge report with per-judge top/bottom quotes and the max-disagreement row", () => {
    const analysis = computeAnalysis([
      row({
        promptVersionId: "vA",
        testCaseId: "tcHigh",
        runIndex: 0,
        finalScore: 0.95,
        judgeAccuracy: 5,
        judgeCoherence: 5,
        judgeInstruction: 5,
        judgeVotes: [
          {
            model: "judge-a",
            accuracy: 5,
            coherence: 5,
            instruction: 5,
            reasoning: "great answer overall",
            inputTokens: 1,
            outputTokens: 1,
            costUsd: 0,
          },
          {
            model: "judge-b",
            accuracy: 4,
            coherence: 5,
            instruction: 5,
            reasoning: "solid but minor issues",
            inputTokens: 1,
            outputTokens: 1,
            costUsd: 0,
          },
        ],
      }),
      row({
        promptVersionId: "vA",
        testCaseId: "tcLow",
        runIndex: 0,
        finalScore: 0.5,
        judgeAccuracy: 3,
        judgeCoherence: 3,
        judgeInstruction: 3,
        judgeVotes: [
          {
            model: "judge-a",
            accuracy: 4,
            coherence: 4,
            instruction: 4,
            reasoning: "mostly fine",
            inputTokens: 1,
            outputTokens: 1,
            costUsd: 0,
          },
          {
            model: "judge-b",
            accuracy: 1,
            coherence: 2,
            instruction: 2,
            reasoning: "off-topic and brittle",
            inputTokens: 1,
            outputTokens: 1,
            costUsd: 0,
          },
        ],
      }),
    ]);

    expect(analysis.ensembleJudgeReport.perCandidate).toHaveLength(1);
    const entry = analysis.ensembleJudgeReport.perCandidate[0]!;
    expect(entry.judges.map((j) => j.model)).toEqual(["judge-a", "judge-b"]);

    const judgeB = entry.judges.find((j) => j.model === "judge-b")!;
    // judge-b liked tcHigh most and tcLow least; the report must surface
    // that judge's own reasoning verbatim rather than synthesised text.
    expect(judgeB.topRated?.testCaseId).toBe("tcHigh");
    expect(judgeB.topRated?.reasoning).toBe("solid but minor issues");
    expect(judgeB.bottomRated?.testCaseId).toBe("tcLow");
    expect(judgeB.bottomRated?.reasoning).toBe("off-topic and brittle");

    // tcLow has the wider per-row split (judge-a mean 4 vs judge-b mean ~1.67),
    // so it must be reported as the disagreement anchor with both judges'
    // reasoning attached.
    expect(entry.maxDisagreement?.testCaseId).toBe("tcLow");
    expect(entry.maxDisagreement?.spread).toBeGreaterThan(0);
    expect(entry.maxDisagreement?.perJudge.map((v) => v.model)).toEqual([
      "judge-a",
      "judge-b",
    ]);
  });

  it("returns an empty ensemble report when there are no completed rows", () => {
    const analysis = computeAnalysis([
      row({ status: "failed", failureKind: "solver_error", finalScore: 0, totalCostUsd: 0 }),
    ]);
    expect(analysis.ensembleJudgeReport.perCandidate).toEqual([]);
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
	          consistencyScore: 1,
	          meanSolverLatencyMs: 100,
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
	          consistencyScore: 1,
	          meanSolverLatencyMs: 100,
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
	          consistencyScore: 1,
	          meanSolverLatencyMs: 100,
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
