import type { JudgeScore } from "../../../domain/value-objects/judge-score.js";

export interface JudgeInput {
  input: string;
  candidate: string;
  seed?: number;
  reference?: string;
  // The system prompt under evaluation — required for the judge's
  // "instruction" axis to reflect prompt-level constraints rather than only
  // constraints stated in the user turn.
  systemPrompt?: string;
}

// Batch grading: N candidates produced by the SAME (system prompt, input)
// — i.e. repetitions of the same cell. The judge sees the candidates with
// shuffled anonymous labels and is instructed to score each one
// independently, so per-candidate scores are comparable to scores from a
// single-call grade. This is NOT used for cross-version comparison; mixing
// candidates from different prompt versions in one call would introduce
// inter-version anchoring bias.
export interface BatchJudgeInput {
  input: string;
  candidates: readonly string[];
  seed?: number;
  reference?: string;
  systemPrompt?: string;
}

export interface JudgeUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface JudgeResult {
  score: JudgeScore;
  usage: JudgeUsage;
  model: string;
}

export interface BatchJudgeResult {
  // Aligned with `BatchJudgeInput.candidates` order.
  scores: JudgeScore[];
  // Aggregate usage of the single underlying judge call. The caller is
  // responsible for attributing this across the candidates (typically equal
  // split, since the judge prompt is shared).
  usage: JudgeUsage;
  model: string;
}

export class JudgeExecutionError extends Error {
  constructor(
    message: string,
    public readonly partial?: {
      usage?: JudgeUsage;
      model?: string;
      reasoning?: string;
    },
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = "JudgeExecutionError";
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export interface IJudge {
  grade(input: JudgeInput): Promise<JudgeResult>;
  gradeBatch(input: BatchJudgeInput): Promise<BatchJudgeResult>;
}
