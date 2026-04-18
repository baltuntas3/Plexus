// One cell × run of a benchmark matrix: a single (testCase × promptVersion ×
// solverModel × runIndex) execution. The unique key (benchmarkId, testCaseId,
// promptVersionId, solverModel, runIndex) is what makes restart-safe runs
// idempotent — the runner skips any row already present with status
// "completed".
//
// The prompt used for each cell is determined by the PromptVersion itself:
// if braidGraph is set, the BRAID graph is the system prompt; otherwise the
// classicalPrompt is used. There is no separate mode field.
//
// Each row is graded by every judge in the benchmark's `judgeModels`; the
// individual votes are stored on `judgeVotes` and the aggregated mean
// (accuracy, coherence, instruction) is kept on the row for fast analysis.

export type BenchmarkResultStatus = "completed" | "failed";

export interface JudgeVote {
  model: string;
  accuracy: number;
  coherence: number;
  instruction: number;
  reasoning: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface BenchmarkResult {
  id: string;
  benchmarkId: string;
  testCaseId: string;
  promptVersionId: string;
  solverModel: string;
  runIndex: number;

  input: string;
  candidateOutput: string;

  // Rubric values are means across the judge ensemble (1..5). rawScore and
  // finalScore are normalised to [0,1] (matching JudgeScore's contract).
  judgeAccuracy: number;
  judgeCoherence: number;
  judgeInstruction: number;
  judgeVotes: JudgeVote[];
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

// Stable identifier for the (testCase, version, solver, runIndex) row. The
// runner uses it to look up which rows are already complete on a resume.
export const benchmarkResultKey = (
  testCaseId: string,
  promptVersionId: string,
  solverModel: string,
  runIndex: number,
): string => `${testCaseId}::${promptVersionId}::${solverModel}::${runIndex}`;
