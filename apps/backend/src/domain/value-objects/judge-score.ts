// LLM-as-judge output scored on a three-axis rubric (paper §3).
//
// Raw rubric values are 1..5 integers produced by the grader model. `rawScore`
// is the rubric mean normalised to 0..1 (so it can feed PPD directly). The
// verbosity penalty (0..1) is applied multiplicatively to produce `finalScore`,
// which is what downstream metrics and the benchmark runner should consume.

export interface JudgeRubric {
  accuracy: number;
  coherence: number;
  instruction: number;
}

export class JudgeScore {
  constructor(
    public readonly rubric: JudgeRubric,
    public readonly rawScore: number,
    public readonly verbosityPenalty: number,
    public readonly finalScore: number,
    public readonly reasoning: string,
  ) {}

  static fromRubric(
    rubric: JudgeRubric,
    verbosityPenalty: number,
    reasoning: string,
  ): JudgeScore {
    assertInRange("accuracy", rubric.accuracy);
    assertInRange("coherence", rubric.coherence);
    assertInRange("instruction", rubric.instruction);
    if (verbosityPenalty < 0 || verbosityPenalty > 1) {
      throw new RangeError(
        `verbosityPenalty must be between 0 and 1, got ${verbosityPenalty}`,
      );
    }

    const mean = (rubric.accuracy + rubric.coherence + rubric.instruction) / 3;
    const rawScore = (mean - 1) / 4;
    const finalScore = rawScore * (1 - verbosityPenalty);
    return new JudgeScore(rubric, rawScore, verbosityPenalty, finalScore, reasoning);
  }
}

const assertInRange = (field: string, value: number): void => {
  if (!Number.isFinite(value) || value < 1 || value > 5) {
    throw new RangeError(`${field} must be between 1 and 5, got ${value}`);
  }
};
