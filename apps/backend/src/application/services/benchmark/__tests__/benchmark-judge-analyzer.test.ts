import type { BenchmarkResult } from "../../../../domain/entities/benchmark-result.js";
import { BenchmarkJudgeAnalyzer } from "../benchmark-judge-analyzer.js";
import type { IAIProviderFactory } from "../../ai-provider.js";

// Minimal IAIProviderFactory stub — tests that exercise computeCategoryStats
// and pickRecommendation never call the AI provider.
const noopProviders: IAIProviderFactory = {
  forModel: () => {
    throw new Error("AI provider should not be called in unit tests");
  },
};

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
  latencyMs: 100,
  status: "completed",
  error: null,
  createdAt: new Date(),
  ...overrides,
});

// Access private methods via casting for unit testing.
const analyzer = new BenchmarkJudgeAnalyzer(noopProviders) as unknown as {
  computeCategoryStats: (results: BenchmarkResult[]) => {
    candidateKey: string;
    meanAccuracy: number;
    meanCoherence: number;
    meanInstruction: number;
    consistencyScore: number;
    meanLatencyMs: number;
    meanCostUsd: number;
    completedCount: number;
  }[];
  pickRecommendation: (stats: ReturnType<typeof analyzer.computeCategoryStats>) => {
    recommendedKey: string | null;
    recommendedReasoning: string;
  };
};

describe("computeCategoryStats — consistency score", () => {
  it("returns 100% when all finalScores are identical (zero variance)", () => {
    const results = [
      row({ promptVersionId: "v1", solverModel: "m", testCaseId: "a", finalScore: 0.8 }),
      row({ promptVersionId: "v1", solverModel: "m", testCaseId: "b", finalScore: 0.8 }),
      row({ promptVersionId: "v1", solverModel: "m", testCaseId: "c", finalScore: 0.8 }),
    ];
    const [stats] = analyzer.computeCategoryStats(results);
    expect(stats?.consistencyScore).toBeCloseTo(1, 10);
  });

  it("returns 0% when stddev reaches the 0.25 ceiling (alternating 1.0 / 0.5)", () => {
    // finalScore 1.0 = all 5/5; finalScore 0.5 = all 3/5
    // stddev([1,0.5,1,0.5]) = 0.25 → consistency = 1 - 0.25/0.25 = 0
    const results = [
      row({ promptVersionId: "v1", solverModel: "m", testCaseId: "a", finalScore: 1.0 }),
      row({ promptVersionId: "v1", solverModel: "m", testCaseId: "b", finalScore: 0.5 }),
      row({ promptVersionId: "v1", solverModel: "m", testCaseId: "c", finalScore: 1.0 }),
      row({ promptVersionId: "v1", solverModel: "m", testCaseId: "d", finalScore: 0.5 }),
    ];
    const [stats] = analyzer.computeCategoryStats(results);
    expect(stats?.consistencyScore).toBe(0);
  });

  it("clamps to 0% for stddev above the ceiling (worst-case alternating 0 / 1)", () => {
    const results = [
      row({ promptVersionId: "v1", solverModel: "m", testCaseId: "a", finalScore: 1.0 }),
      row({ promptVersionId: "v1", solverModel: "m", testCaseId: "b", finalScore: 0.0 }),
      row({ promptVersionId: "v1", solverModel: "m", testCaseId: "c", finalScore: 1.0 }),
      row({ promptVersionId: "v1", solverModel: "m", testCaseId: "d", finalScore: 0.0 }),
    ];
    const [stats] = analyzer.computeCategoryStats(results);
    expect(stats?.consistencyScore).toBe(0);
  });

  it("returns ~79% for typical good model with moderate variance", () => {
    // stddev([0.8, 0.85, 0.75, 0.9, 0.78]) ≈ 0.0531 → 1 - 0.0531/0.25 ≈ 0.787
    const results = [
      row({ promptVersionId: "v1", solverModel: "m", testCaseId: "a", finalScore: 0.80 }),
      row({ promptVersionId: "v1", solverModel: "m", testCaseId: "b", finalScore: 0.85 }),
      row({ promptVersionId: "v1", solverModel: "m", testCaseId: "c", finalScore: 0.75 }),
      row({ promptVersionId: "v1", solverModel: "m", testCaseId: "d", finalScore: 0.90 }),
      row({ promptVersionId: "v1", solverModel: "m", testCaseId: "e", finalScore: 0.78 }),
    ];
    const [stats] = analyzer.computeCategoryStats(results);
    expect(stats?.consistencyScore).toBeCloseTo(0.787, 2);
  });

  it("returns ~96% for very consistent model", () => {
    // stddev([0.78, 0.80, 0.79, 0.81, 0.80]) ≈ 0.0102 → 1 - 0.0102/0.25 ≈ 0.959
    const results = [
      row({ promptVersionId: "v1", solverModel: "m", testCaseId: "a", finalScore: 0.78 }),
      row({ promptVersionId: "v1", solverModel: "m", testCaseId: "b", finalScore: 0.80 }),
      row({ promptVersionId: "v1", solverModel: "m", testCaseId: "c", finalScore: 0.79 }),
      row({ promptVersionId: "v1", solverModel: "m", testCaseId: "d", finalScore: 0.81 }),
      row({ promptVersionId: "v1", solverModel: "m", testCaseId: "e", finalScore: 0.80 }),
    ];
    const [stats] = analyzer.computeCategoryStats(results);
    expect(stats?.consistencyScore).toBeCloseTo(0.959, 2);
  });

  it("returns 100% for a single result (stddev undefined → 0)", () => {
    const results = [
      row({ promptVersionId: "v1", solverModel: "m", testCaseId: "a", finalScore: 0.85 }),
    ];
    const [stats] = analyzer.computeCategoryStats(results);
    expect(stats?.consistencyScore).toBe(1);
  });

  it("skips failed results", () => {
    const results = [
      row({ promptVersionId: "v1", solverModel: "m", testCaseId: "a", finalScore: 0.8, status: "completed" }),
      row({ promptVersionId: "v1", solverModel: "m", testCaseId: "b", finalScore: 0.0, status: "failed" }),
      row({ promptVersionId: "v1", solverModel: "m", testCaseId: "c", finalScore: 0.8, status: "completed" }),
    ];
    const [stats] = analyzer.computeCategoryStats(results);
    // Only 2 completed rows, both 0.8 → variance = 0 → consistency = 100%
    expect(stats?.consistencyScore).toBe(1);
    expect(stats?.completedCount).toBe(2);
  });
});

describe("pickRecommendation", () => {
  it("prefers the candidate with higher quality scores", () => {
    const stats = analyzer.computeCategoryStats([
      row({ promptVersionId: "vA", solverModel: "m", testCaseId: "a", judgeAccuracy: 5, judgeCoherence: 5, judgeInstruction: 5, finalScore: 1.0 }),
      row({ promptVersionId: "vB", solverModel: "m", testCaseId: "a", judgeAccuracy: 3, judgeCoherence: 3, judgeInstruction: 3, finalScore: 0.5 }),
    ]);
    const { recommendedKey } = analyzer.pickRecommendation(stats);
    expect(recommendedKey).toContain("vA");
  });

  it("returns null when stats array is empty", () => {
    const { recommendedKey } = analyzer.pickRecommendation([]);
    expect(recommendedKey).toBeNull();
  });

  it("does not recommend a candidate with zero quality score even if it has lower latency/cost", () => {
    // vA: all 1s (worst quality) but very fast/cheap
    // vB: all 5s but slower/more expensive
    const stats = analyzer.computeCategoryStats([
      row({ promptVersionId: "vA", solverModel: "m", testCaseId: "a", judgeAccuracy: 1, judgeCoherence: 1, judgeInstruction: 1, finalScore: 0.0, latencyMs: 50, totalCostUsd: 0.0001 }),
      row({ promptVersionId: "vB", solverModel: "m", testCaseId: "a", judgeAccuracy: 5, judgeCoherence: 5, judgeInstruction: 5, finalScore: 1.0, latencyMs: 5000, totalCostUsd: 0.05 }),
    ]);
    const { recommendedKey } = analyzer.pickRecommendation(stats);
    // vA quality norm = 0 → geometric mean = 0 → should not win despite efficiency
    expect(recommendedKey).toContain("vB");
  });
});
