import { JudgeScore } from "../judge-score.js";

describe("JudgeScore.fromRubric", () => {
  it("maps a perfect rubric to raw score 1.0", () => {
    const score = JudgeScore.fromRubric(
      { accuracy: 5, coherence: 5, instruction: 5 },
      0,
      "flawless",
    );
    expect(score.rawScore).toBe(1);
    expect(score.finalScore).toBe(1);
  });

  it("maps a minimum rubric to raw score 0", () => {
    const score = JudgeScore.fromRubric(
      { accuracy: 1, coherence: 1, instruction: 1 },
      0,
      "unusable",
    );
    expect(score.rawScore).toBe(0);
    expect(score.finalScore).toBe(0);
  });

  it("computes raw score as the normalised mean of the three axes", () => {
    // mean = (4 + 3 + 2)/3 = 3 → raw = (3-1)/4 = 0.5
    const score = JudgeScore.fromRubric(
      { accuracy: 4, coherence: 3, instruction: 2 },
      0,
      "mixed",
    );
    expect(score.rawScore).toBe(0.5);
  });

  it("applies verbosity penalty multiplicatively to the final score", () => {
    const score = JudgeScore.fromRubric(
      { accuracy: 5, coherence: 5, instruction: 5 },
      0.3,
      "too long",
    );
    expect(score.rawScore).toBe(1);
    expect(score.finalScore).toBeCloseTo(0.7, 6);
  });

  it("rejects rubric values outside 1..5", () => {
    expect(() =>
      JudgeScore.fromRubric({ accuracy: 6, coherence: 3, instruction: 3 }, 0, "r"),
    ).toThrow(RangeError);
    expect(() =>
      JudgeScore.fromRubric({ accuracy: 0, coherence: 3, instruction: 3 }, 0, "r"),
    ).toThrow(RangeError);
  });

  it("rejects verbosity penalty outside [0,1]", () => {
    expect(() =>
      JudgeScore.fromRubric({ accuracy: 5, coherence: 5, instruction: 5 }, 1.1, "r"),
    ).toThrow(RangeError);
    expect(() =>
      JudgeScore.fromRubric({ accuracy: 5, coherence: 5, instruction: 5 }, -0.1, "r"),
    ).toThrow(RangeError);
  });
});
