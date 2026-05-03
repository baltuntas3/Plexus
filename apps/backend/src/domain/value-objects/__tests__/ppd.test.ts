import { PPD } from "../ppd.js";

describe("PPD.compute", () => {
  it("returns 1 when candidate matches baseline exactly", () => {
    const ppd = PPD.compute(
      { accuracy: 0.8, costUsd: 1 },
      { accuracy: 0.8, costUsd: 1 },
    );
    expect(ppd.value).toBe(1);
    expect(ppd.isMoreEfficient).toBe(false);
  });

  it("returns >1 when the candidate gives more accuracy per dollar", () => {
    // candidate: 0.8 / 0.5 = 1.6, baseline: 0.8 / 1 = 0.8 → PPD = 2
    const ppd = PPD.compute(
      { accuracy: 0.8, costUsd: 0.5 },
      { accuracy: 0.8, costUsd: 1 },
    );
    expect(ppd.value).toBeCloseTo(2, 6);
    expect(ppd.isMoreEfficient).toBe(true);
  });

  it("returns <1 when the candidate is less efficient", () => {
    // candidate: 0.5/1 = 0.5, baseline: 0.8/1 = 0.8 → PPD = 0.625
    const ppd = PPD.compute(
      { accuracy: 0.5, costUsd: 1 },
      { accuracy: 0.8, costUsd: 1 },
    );
    expect(ppd.value).toBeCloseTo(0.625, 6);
    expect(ppd.isMoreEfficient).toBe(false);
  });

  it("treats a zero-cost candidate as infinitely efficient", () => {
    const ppd = PPD.compute(
      { accuracy: 0.5, costUsd: 0 },
      { accuracy: 0.8, costUsd: 1 },
    );
    expect(ppd.value).toBe(Number.POSITIVE_INFINITY);
  });

  it("rejects a zero-cost baseline", () => {
    expect(() =>
      PPD.compute({ accuracy: 0.8, costUsd: 1 }, { accuracy: 0.8, costUsd: 0 }),
    ).toThrow(/baseline.costUsd/);
  });

  it("rejects a zero-accuracy baseline", () => {
    expect(() =>
      PPD.compute({ accuracy: 0.8, costUsd: 1 }, { accuracy: 0, costUsd: 1 }),
    ).toThrow(/baseline.accuracy/);
  });

  it("rejects accuracy outside [0,1]", () => {
    expect(() =>
      PPD.compute({ accuracy: 1.2, costUsd: 1 }, { accuracy: 0.8, costUsd: 1 }),
    ).toThrow(/candidate accuracy/);
    expect(() =>
      PPD.compute({ accuracy: 0.8, costUsd: 1 }, { accuracy: -0.1, costUsd: 1 }),
    ).toThrow(/baseline accuracy/);
  });

  it("rejects negative cost", () => {
    expect(() =>
      PPD.compute({ accuracy: 0.8, costUsd: -1 }, { accuracy: 0.8, costUsd: 1 }),
    ).toThrow(/candidate.costUsd/);
  });
});
