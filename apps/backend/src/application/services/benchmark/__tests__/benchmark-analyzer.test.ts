import type { BenchmarkResult } from "../../../../domain/entities/benchmark-result.js";
import {
  aggregateResults,
  analyzeBenchmark,
  candidateKey,
  computeParetoFrontier,
} from "../benchmark-analyzer.js";

let nextId = 1;
const row = (overrides: Partial<BenchmarkResult>): BenchmarkResult => ({
  id: String(nextId++),
  benchmarkId: "bm",
  testCaseId: "tc1",
  promptVersionId: "v1",
  solverModel: "gpt-4o",
  input: "",
  candidateOutput: "",
  judgeAccuracy: 5,
  judgeCoherence: 5,
  judgeInstruction: 5,
  judgeReasoning: "",
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

  it("counts failed cells separately and excludes them from the score average", () => {
    const candidates = aggregateResults([
      row({ testCaseId: "a", finalScore: 0.8, totalCostUsd: 0.01 }),
      row({ testCaseId: "b", status: "failed", finalScore: 0, totalCostUsd: 0 }),
    ]);

    expect(candidates).toHaveLength(1);
    const c = candidates[0]!;
    expect(c.completedCount).toBe(1);
    expect(c.failedCount).toBe(1);
    expect(c.meanFinalScore).toBeCloseTo(0.8, 6);
  });
});

describe("computeParetoFrontier", () => {
  it("keeps only non-dominated candidates", () => {
    const candidates = aggregateResults([
      // A: high score, high cost
      row({ promptVersionId: "vA", finalScore: 0.95, totalCostUsd: 1 }),
      // B: medium score, medium cost
      row({ promptVersionId: "vB", finalScore: 0.85, totalCostUsd: 0.5 }),
      // C: low score, low cost
      row({ promptVersionId: "vC", finalScore: 0.7, totalCostUsd: 0.05 }),
      // D: dominated by B (lower score AND higher cost)
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
});

describe("analyzeBenchmark", () => {
  it("recommends the cheapest candidate that still clears the score floor", () => {
    const analysis = analyzeBenchmark([
      row({ promptVersionId: "vBig", finalScore: 1.0, totalCostUsd: 1.0 }),
      row({ promptVersionId: "vMid", finalScore: 0.85, totalCostUsd: 0.1 }),
      row({ promptVersionId: "vCheapBad", finalScore: 0.4, totalCostUsd: 0.001 }),
    ]);

    expect(analysis.baselineKey).toBeTruthy();
    expect(analysis.recommendedKey).toBeTruthy();
    // vMid: score >= 0.8 (80% of 1.0), much cheaper than vBig — best PPD.
    expect(analysis.recommendedKey).toContain("vMid");

    const recommended = analysis.ppd.find(
      (row) => candidateKey(row.candidate) === analysis.recommendedKey,
    );
    expect(recommended?.isMoreEfficient).toBe(true);
  });

  it("does not recommend a cheap-but-bad candidate", () => {
    const analysis = analyzeBenchmark([
      row({ promptVersionId: "vBig", finalScore: 0.95, totalCostUsd: 1.0 }),
      row({ promptVersionId: "vCheapBad", finalScore: 0.3, totalCostUsd: 0.001 }),
    ]);
    expect(analysis.recommendedKey).not.toContain("vCheapBad");
    expect(analysis.recommendedKey).toContain("vBig");
  });

  it("returns empty PPD when there are no completed rows", () => {
    const analysis = analyzeBenchmark([
      row({ status: "failed", finalScore: 0, totalCostUsd: 0 }),
    ]);
    expect(analysis.ppd).toEqual([]);
    expect(analysis.recommendedKey).toBeNull();
  });
});
