import { buildJudgeScore } from "../judge-score.js";

describe("buildJudgeScore", () => {
  it("maps a perfect rubric to final score 1.0", () => {
    const score = buildJudgeScore(
      { accuracy: 5, coherence: 5, instruction: 5 },
      "flawless",
    );
    expect(score.finalScore).toBe(1);
  });

  it("maps a minimum rubric to final score 0", () => {
    const score = buildJudgeScore(
      { accuracy: 1, coherence: 1, instruction: 1 },
      "unusable",
    );
    expect(score.finalScore).toBe(0);
  });

  it("computes final score as the normalised mean of the three axes", () => {
    // mean = (4 + 3 + 2)/3 = 3 → final = (3-1)/4 = 0.5
    const score = buildJudgeScore(
      { accuracy: 4, coherence: 3, instruction: 2 },
      "mixed",
    );
    expect(score.finalScore).toBe(0.5);
  });

  it("rejects rubric values outside 1..5", () => {
    expect(() =>
      buildJudgeScore({ accuracy: 6, coherence: 3, instruction: 3 }, "r"),
    ).toThrow(RangeError);
    expect(() =>
      buildJudgeScore({ accuracy: 0, coherence: 3, instruction: 3 }, "r"),
    ).toThrow(RangeError);
  });
});
