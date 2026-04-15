import { computeVerbosityPenalty } from "../verbosity-penalty.js";

describe("computeVerbosityPenalty", () => {
  it("is 0 when no reference is provided", () => {
    expect(computeVerbosityPenalty("a".repeat(1000), undefined)).toBe(0);
  });

  it("is 0 when candidate is within 2x reference length", () => {
    const ref = "a".repeat(100);
    expect(computeVerbosityPenalty("a".repeat(100), ref)).toBe(0);
    expect(computeVerbosityPenalty("a".repeat(200), ref)).toBe(0);
  });

  it("caps at 0.5 when candidate is >=4x reference length", () => {
    const ref = "a".repeat(100);
    expect(computeVerbosityPenalty("a".repeat(400), ref)).toBe(0.5);
    expect(computeVerbosityPenalty("a".repeat(10_000), ref)).toBe(0.5);
  });

  it("ramps linearly between 2x and 4x", () => {
    const ref = "a".repeat(100);
    // 3x → halfway → 0.25
    expect(computeVerbosityPenalty("a".repeat(300), ref)).toBeCloseTo(0.25, 6);
  });
});
