// Computes per-candidate category statistics (accuracy, coherence, instruction,
// consistency, latency, cost) from raw BenchmarkResult rows, then calls an LLM
// to produce natural-language commentary. The recommendation is computed
// deterministically via a weighted composite score so that model selection is
// stable and explainable.
//
// Weights: accuracy 25%, coherence 20%, instruction 20%, consistency 15%,
// latency efficiency 10%, cost efficiency 10%.
// Latency and cost are min-max normalised within the candidate set so relative
// performance is captured without requiring arbitrary absolute thresholds.
//
// `consistencyScore` measures how stable scores are across test cases:
// 1.0 = identical score on every test, 0.0 = maximum variance. It is derived
// from the standard deviation of finalScore (range 0..1) normalised by 0.25.
// 0.25 is the practical ceiling for real LLM benchmark runs — a stddev of 0.25
// corresponds to very high spread (e.g., alternating scores near 0 and 1), so
// anything above it is capped at 0% consistency.

import type { BenchmarkResult } from "../../../domain/entities/benchmark-result.js";
import type { IAIProviderFactory } from "../ai-provider.js";
import { candidateKey } from "./benchmark-analyzer.js";

export interface CandidateCategoryStats {
  candidateKey: string;
  promptVersionId: string;
  solverModel: string;
  meanAccuracy: number;
  meanCoherence: number;
  meanInstruction: number;
  consistencyScore: number;
  meanLatencyMs: number;
  meanCostUsd: number;
  completedCount: number;
}

export interface BenchmarkJudgeAnalysis {
  categoryStats: CandidateCategoryStats[];
  commentary: string;
  recommendedKey: string | null;
  recommendedReasoning: string;
}

const stddev = (values: number[]): number => {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};


export class BenchmarkJudgeAnalyzer {
  constructor(private readonly providers: IAIProviderFactory) {}

  async analyze(
    results: BenchmarkResult[],
    versionLabels: Record<string, string>,
    judgeModel: string,
  ): Promise<BenchmarkJudgeAnalysis> {
    const categoryStats = this.computeCategoryStats(results);

    if (categoryStats.length === 0) {
      return {
        categoryStats: [],
        commentary: "No completed results to analyze.",
        recommendedKey: null,
        recommendedReasoning: "",
      };
    }

    const insights = await this.generateInsights(categoryStats, versionLabels, judgeModel);
    return { categoryStats, ...insights };
  }

  private computeCategoryStats(results: BenchmarkResult[]): CandidateCategoryStats[] {
    type Acc = {
      accuracySum: number;
      coherenceSum: number;
      instructionSum: number;
      latencySum: number;
      costSum: number;
      finalScores: number[];
      promptVersionId: string;
      solverModel: string;
    };

    const buckets = new Map<string, Acc>();

    for (const r of results) {
      if (r.status !== "completed") continue;
      const key = candidateKey(r);
      let acc = buckets.get(key);
      if (!acc) {
        acc = {
          accuracySum: 0,
          coherenceSum: 0,
          instructionSum: 0,
          latencySum: 0,
          costSum: 0,
          finalScores: [],
          promptVersionId: r.promptVersionId,
          solverModel: r.solverModel,
        };
        buckets.set(key, acc);
      }
      acc.accuracySum += r.judgeAccuracy;
      acc.coherenceSum += r.judgeCoherence;
      acc.instructionSum += r.judgeInstruction;
      acc.latencySum += r.latencyMs;
      acc.costSum += r.totalCostUsd;
      acc.finalScores.push(r.finalScore);
    }

    return Array.from(buckets.entries()).map(([key, acc]) => {
      const n = acc.finalScores.length;
      const sd = stddev(acc.finalScores);
      // finalScore is [0,1]; practical high-variance ceiling is 0.25 (e.g., scores
      // alternating between low and high values in a real benchmark run).
      const consistencyScore = Math.max(0, Math.min(1, 1 - sd / 0.25));
      return {
        candidateKey: key,
        promptVersionId: acc.promptVersionId,
        solverModel: acc.solverModel,
        meanAccuracy: acc.accuracySum / n,
        meanCoherence: acc.coherenceSum / n,
        meanInstruction: acc.instructionSum / n,
        consistencyScore,
        meanLatencyMs: acc.latencySum / n,
        meanCostUsd: acc.costSum / n,
        completedCount: n,
      };
    });
  }

  private pickRecommendation(stats: CandidateCategoryStats[]): {
    recommendedKey: string | null;
    recommendedReasoning: string;
  } {
    if (stats.length === 0) return { recommendedKey: null, recommendedReasoning: "" };

    // Latency and cost: lower is better. Min-max normalise within the candidate
    // set so the fastest/cheapest scores 1.0 and the slowest/most-expensive scores
    // 0.0. When all candidates are equal the range is 0 → everyone gets 1.0.
    const minMaxNorm = (values: number[], value: number): number => {
      const min = Math.min(...values);
      const max = Math.max(...values);
      if (max === min) return 1;
      return (max - value) / (max - min);
    };

    const latencies = stats.map((s) => s.meanLatencyMs);
    const costs = stats.map((s) => s.meanCostUsd);

    // Composite score (two parts, summing to 1.0):
    //
    // 1. Quality (80%): weighted geometric mean of the four rubric dimensions.
    //    Geometric mean penalises imbalance — a candidate that excels in accuracy
    //    but fails in coherence cannot compensate via averaging.
    //    Exponents are the individual weights re-normalised to sum to 1:
    //      accuracy 25/80, coherence 20/80, instruction 20/80, consistency 15/80.
    //
    // 2. Efficiency (20%): plain weighted sum of latency and cost (each 10%).
    //    Min-max normalisation produces a guaranteed 0.0 for the worst performer,
    //    which would collapse the geometric product — so additive combination is
    //    used here instead.
    //
    // Rubric means are 1-5, normalised to [0,1] before weighting.
    const scored = stats.map((s) => ({
      key: s.candidateKey,
      score: (() => {
        const acc  = (s.meanAccuracy    - 1) / 4;
        const coh  = (s.meanCoherence   - 1) / 4;
        const ins  = (s.meanInstruction - 1) / 4;
        const con  = s.consistencyScore;
        const qualityScore =
          Math.pow(acc, 25 / 80) *
          Math.pow(coh, 20 / 80) *
          Math.pow(ins, 20 / 80) *
          Math.pow(con, 15 / 80);
        const efficiencyScore =
          0.10 * minMaxNorm(latencies, s.meanLatencyMs) +
          0.10 * minMaxNorm(costs, s.meanCostUsd);
        return 0.80 * qualityScore + efficiencyScore;
      })(),
      stats: s,
    }));

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best) return { recommendedKey: null, recommendedReasoning: "" };

    const s = best.stats;
    const recommendedReasoning =
      `Composite score ${(best.score * 100).toFixed(1)}% — ` +
      `Accuracy ${s.meanAccuracy.toFixed(2)}, ` +
      `Coherence ${s.meanCoherence.toFixed(2)}, ` +
      `Instruction ${s.meanInstruction.toFixed(2)}, ` +
      `Consistency ${(s.consistencyScore * 100).toFixed(1)}%, ` +
      `Latency ${Math.round(s.meanLatencyMs)} ms, ` +
      `Cost $${s.meanCostUsd.toFixed(4)}/test.`;

    return { recommendedKey: best.key, recommendedReasoning };
  }

  private async generateInsights(
    stats: CandidateCategoryStats[],
    versionLabels: Record<string, string>,
    judgeModel: string,
  ): Promise<{ commentary: string; recommendedKey: string | null; recommendedReasoning: string }> {
    const { recommendedKey, recommendedReasoning } = this.pickRecommendation(stats);

    const candidateLines = stats
      .map((s) => {
        const vLabel = versionLabels[s.promptVersionId] ?? s.promptVersionId.slice(-6);
        return [
          `Candidate: ${vLabel} × ${s.solverModel}`,
          `  Accuracy (1-5):    ${s.meanAccuracy.toFixed(2)}`,
          `  Coherence (1-5):   ${s.meanCoherence.toFixed(2)}`,
          `  Instruction (1-5): ${s.meanInstruction.toFixed(2)}`,
          `  Consistency:       ${(s.consistencyScore * 100).toFixed(1)}%`,
          `  Avg latency:       ${Math.round(s.meanLatencyMs)} ms`,
          `  Avg cost/test:     $${s.meanCostUsd.toFixed(4)}`,
          `  Test cases:        ${s.completedCount}`,
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
- Consistency (%): Stability of scores across test cases — 100% means the candidate scored identically on every test.
- Avg latency: Mean response time per test case.
- Avg cost/test: Mean total LLM cost (candidate + judge) per test case in USD.

Write a detailed analysis paragraph (3-5 sentences) comparing each candidate across all six dimensions. Highlight strengths, weaknesses, and any surprising patterns. Do not include a recommendation — just the analysis.

Return only the paragraph text, no JSON, no headings.`;

    const provider = this.providers.forModel(judgeModel);
    const response = await provider.generate({
      model: judgeModel,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    });

    return {
      commentary: response.text.trim(),
      recommendedKey,
      recommendedReasoning,
    };
  }
}
