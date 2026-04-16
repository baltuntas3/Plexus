// Computes per-candidate category statistics (accuracy, coherence, instruction,
// consistency) from raw BenchmarkResult rows, then calls an LLM to produce
// natural-language commentary and a recommendation.
//
// `consistencyScore` measures how stable scores are across test cases:
// 1.0 = identical score on every test, 0.0 = maximum variance. It is derived
// from the standard deviation of finalScore (range 0..1) normalised by the
// theoretical maximum stddev of 0.5.

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

const stripFences = (text: string): string => {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
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
      acc.finalScores.push(r.finalScore);
    }

    return Array.from(buckets.entries()).map(([key, acc]) => {
      const n = acc.finalScores.length;
      const sd = stddev(acc.finalScores);
      // finalScore is [0,1]; max theoretical stddev is 0.5 (half at 0, half at 1)
      const consistencyScore = Math.max(0, Math.min(1, 1 - sd / 0.5));
      return {
        candidateKey: key,
        promptVersionId: acc.promptVersionId,
        solverModel: acc.solverModel,
        meanAccuracy: acc.accuracySum / n,
        meanCoherence: acc.coherenceSum / n,
        meanInstruction: acc.instructionSum / n,
        consistencyScore,
        meanLatencyMs: acc.latencySum / n,
        completedCount: n,
      };
    });
  }

  private async generateInsights(
    stats: CandidateCategoryStats[],
    versionLabels: Record<string, string>,
    judgeModel: string,
  ): Promise<{ commentary: string; recommendedKey: string | null; recommendedReasoning: string }> {
    const candidateLines = stats
      .map((s) => {
        const vLabel = versionLabels[s.promptVersionId] ?? s.promptVersionId.slice(-6);
        return [
          `Candidate: ${vLabel} × ${s.solverModel}`,
          `  key: ${s.candidateKey}`,
          `  Accuracy (1-5):    ${s.meanAccuracy.toFixed(2)}`,
          `  Coherence (1-5):   ${s.meanCoherence.toFixed(2)}`,
          `  Instruction (1-5): ${s.meanInstruction.toFixed(2)}`,
          `  Consistency:       ${(s.consistencyScore * 100).toFixed(1)}%`,
          `  Avg latency:       ${Math.round(s.meanLatencyMs)} ms`,
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

Respond with a JSON object having exactly these three fields:
{
  "commentary": "A detailed paragraph (3-5 sentences) analyzing each candidate across all four dimensions. Compare candidates directly, highlight what is strong or weak, and note any surprising patterns.",
  "recommendedKey": "the candidateKey string of the best overall candidate, or null if results are inconclusive",
  "recommendedReasoning": "One or two sentences explaining why this candidate is recommended, citing the specific metrics that drive the decision."
}

Return only the JSON object. No prose outside it.`;

    const provider = this.providers.forModel(judgeModel);
    const response = await provider.generate({
      model: judgeModel,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    });

    try {
      const parsed = JSON.parse(stripFences(response.text)) as {
        commentary?: string;
        recommendedKey?: string | null;
        recommendedReasoning?: string;
      };
      return {
        commentary: parsed.commentary ?? "",
        recommendedKey: parsed.recommendedKey ?? null,
        recommendedReasoning: parsed.recommendedReasoning ?? "",
      };
    } catch {
      return {
        commentary: response.text,
        recommendedKey: null,
        recommendedReasoning: "",
      };
    }
  }
}
