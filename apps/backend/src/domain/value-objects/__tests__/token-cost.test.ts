import { TokenCost } from "../token-cost.js";

describe("TokenCost", () => {
  it("computes total USD from input/output prices per million", () => {
    const cost = new TokenCost(1_000_000, 500_000, 2.5, 10);
    expect(cost.inputCostUsd).toBeCloseTo(2.5);
    expect(cost.outputCostUsd).toBeCloseTo(5);
    expect(cost.totalUsd).toBeCloseTo(7.5);
  });

  it("scales sub-million token counts proportionally", () => {
    const cost = new TokenCost(1_000, 1_000, 10, 20);
    expect(cost.inputCostUsd).toBeCloseTo(0.01);
    expect(cost.outputCostUsd).toBeCloseTo(0.02);
  });
});
