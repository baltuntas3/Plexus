import { JudgeScore } from "../judge-score.js";

describe("JudgeScore.fromRubric", () => {
  it("maps a perfect rubric to raw score 1.0", () => {
    const score = JudgeScore.fromRubric(
      { accuracy: 5, coherence: 5, instruction: 5 },
      "flawless",
    );
    expect(score.rawScore).toBe(1);
    expect(score.finalScore).toBe(1);
  });

  it("maps a minimum rubric to raw score 0", () => {
    const score = JudgeScore.fromRubric(
      { accuracy: 1, coherence: 1, instruction: 1 },
      "unusable",
    );
    expect(score.rawScore).toBe(0);
    expect(score.finalScore).toBe(0);
  });

  it("computes raw score as the normalised mean of the three axes", () => {
    // mean = (4 + 3 + 2)/3 = 3 → raw = (3-1)/4 = 0.5
    const score = JudgeScore.fromRubric(
      { accuracy: 4, coherence: 3, instruction: 2 },
      "mixed",
    );
    expect(score.rawScore).toBe(0.5);
  });

  it("returns finalScore equal to rawScore — no length penalty applied", () => {
    // Length expectations belong in the prompt; the judge's `instruction`
    // axis already grades whether the candidate respected them. There is
    // no separate verbosity penalty multiplier on top.
    const score = JudgeScore.fromRubric(
      { accuracy: 5, coherence: 5, instruction: 5 },
      "perfect",
    );
    expect(score.finalScore).toBe(score.rawScore);
  });

  it("rejects rubric values outside 1..5", () => {
    expect(() =>
      JudgeScore.fromRubric({ accuracy: 6, coherence: 3, instruction: 3 }, "r"),
    ).toThrow(RangeError);
    expect(() =>
      JudgeScore.fromRubric({ accuracy: 0, coherence: 3, instruction: 3 }, "r"),
    ).toThrow(RangeError);
  });
});
