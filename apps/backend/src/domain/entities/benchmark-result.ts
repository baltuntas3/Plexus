// One cell of a benchmark matrix: a single (testCase × promptVersion ×
// solverModel) execution. The unique key (benchmarkId, testCaseId,
// promptVersionId, solverModel) is what makes restart-safe runs idempotent —
// the runner skips any cell already present with status "completed".
//
// The prompt used for each cell is determined by the PromptVersion itself:
// if braidGraph is set, the BRAID graph is the system prompt; otherwise the
// classicalPrompt is used. There is no separate mode field.

export type BenchmarkResultStatus = "completed" | "failed";

export interface BenchmarkResult {
  id: string;
  benchmarkId: string;
  testCaseId: string;
  promptVersionId: string;
  solverModel: string;

  input: string;
  candidateOutput: string;

  // Rubric values are 1..5 integers from the judge model. rawScore and
  // finalScore are normalised to [0,1] (matching JudgeScore's contract).
  judgeAccuracy: number;
  judgeCoherence: number;
  judgeInstruction: number;
  judgeReasoning: string;
  rawScore: number;
  verbosityPenalty: number;
  finalScore: number;

  candidateInputTokens: number;
  candidateOutputTokens: number;
  candidateCostUsd: number;
  judgeInputTokens: number;
  judgeOutputTokens: number;
  judgeCostUsd: number;
  totalCostUsd: number;

  latencyMs: number;
  status: BenchmarkResultStatus;
  error: string | null;
  createdAt: Date;
}

// Stable identifier for the (testCase, version, solver) cell. The runner uses
// it to look up which cells are already complete on a resume.
export const benchmarkResultKey = (
  testCaseId: string,
  promptVersionId: string,
  solverModel: string,
): string => `${testCaseId}::${promptVersionId}::${solverModel}`;
