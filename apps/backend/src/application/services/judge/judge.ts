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

export interface JudgeUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface JudgeResult {
  score: JudgeScore;
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
}
