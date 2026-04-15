import type { JudgeScore } from "../../../domain/value-objects/judge-score.js";

export interface JudgeInput {
  input: string;
  candidate: string;
  reference?: string;
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

export interface IJudge {
  grade(input: JudgeInput): Promise<JudgeResult>;
}
