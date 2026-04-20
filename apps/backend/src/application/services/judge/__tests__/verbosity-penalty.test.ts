import {
  computeVerbosityPenalty,
  computeVerbosityPenaltyAgainstBaseline,
} from "../verbosity-penalty.js";

describe("computeVerbosityPenalty", () => {
  it("is 0 when no reference is provided", () => {
    expect(computeVerbosityPenalty("a ".repeat(1000), undefined)).toBe(0);
  });

  it("is 0 when candidate is within 2x reference length", () => {
    const ref = "a ".repeat(100);
    expect(computeVerbosityPenalty("a ".repeat(100), ref)).toBe(0);
    expect(computeVerbosityPenalty("a ".repeat(200), ref)).toBe(0);
  });

  it("caps at 0.5 when candidate is >=4x reference length", () => {
    const ref = "a ".repeat(100);
    expect(computeVerbosityPenalty("a ".repeat(400), ref)).toBe(0.5);
    expect(computeVerbosityPenalty("a ".repeat(10_000), ref)).toBe(0.5);
  });

  it("ramps linearly between 2x and 4x", () => {
    const ref = "a ".repeat(100);
    // 3x → halfway → 0.25
    expect(computeVerbosityPenalty("a ".repeat(300), ref)).toBeCloseTo(0.25, 6);
  });

  it("penalizes overly short answers against the same reference baseline", () => {
    const ref = "a ".repeat(100);
    expect(computeVerbosityPenalty("a ".repeat(60), ref)).toBe(0);
    expect(computeVerbosityPenalty("a ".repeat(25), ref)).toBe(0.5);
  });
});

describe("computeVerbosityPenaltyAgainstBaseline", () => {
  it("returns 0 when baseline length is not positive", () => {
    expect(computeVerbosityPenaltyAgainstBaseline(1000, 0)).toBe(0);
  });

  it("uses the same ramp as the reference-based variant", () => {
    expect(computeVerbosityPenaltyAgainstBaseline(200, 100)).toBe(0);
    expect(computeVerbosityPenaltyAgainstBaseline(300, 100)).toBeCloseTo(0.25, 6);
    expect(computeVerbosityPenaltyAgainstBaseline(400, 100)).toBe(0.5);
    expect(computeVerbosityPenaltyAgainstBaseline(10_000, 100)).toBe(0.5);
  });
});
