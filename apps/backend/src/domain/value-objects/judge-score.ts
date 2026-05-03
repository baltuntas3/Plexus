// LLM-as-judge output scored on a three-axis rubric (paper §3).
//
// Raw rubric values are 1..5 integers produced by the grader model. `rawScore`
// is the rubric mean normalised to 0..1 (so it can feed PPD directly).
// `finalScore` mirrors `rawScore` — there is no length penalty on top.
// Length / brevity expectations belong in the prompt itself; the judge's
// `instruction` axis already grades whether the candidate respected them.

export interface JudgeRubric {
  accuracy: number;
  coherence: number;
  instruction: number;
}

export class JudgeScore {
  constructor(
    public readonly rubric: JudgeRubric,
    public readonly rawScore: number,
    public readonly finalScore: number,
    public readonly reasoning: string,
  ) {}

  static fromRubric(
    rubric: JudgeRubric,
    reasoning: string,
  ): JudgeScore {
    assertInRange("accuracy", rubric.accuracy);
    assertInRange("coherence", rubric.coherence);
    assertInRange("instruction", rubric.instruction);

    const mean = (rubric.accuracy + rubric.coherence + rubric.instruction) / 3;
    const rawScore = (mean - 1) / 4;
    return new JudgeScore(rubric, rawScore, rawScore, reasoning);
  }
}

const assertInRange = (field: string, value: number): void => {
  if (!Number.isFinite(value) || value < 1 || value > 5) {
    throw new RangeError(`${field} must be between 1 and 5, got ${value}`);
  }
};
