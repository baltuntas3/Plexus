import { TokenCost } from "../token-cost.js";

describe("TokenCost", () => {
  it("computes total USD from input/output prices per million", () => {
    const cost = new TokenCost(1_000_000, 500_000, 2.5, 10);
    expect(cost.inputCostUsd).toBeCloseTo(2.5);
    expect(cost.outputCostUsd).toBeCloseTo(5);
    expect(cost.totalUsd).toBeCloseTo(7.5);
  });

  it("returns zero for empty cost", () => {
    const zero = TokenCost.zero();
    expect(zero.totalUsd).toBe(0);
    expect(zero.inputTokens).toBe(0);
    expect(zero.outputTokens).toBe(0);
  });

  it("totalCents is totalUsd * 100", () => {
    const cost = new TokenCost(2_000_000, 0, 3, 0);
    expect(cost.totalCents).toBeCloseTo(600);
  });

  it("add() sums tokens but keeps left-side prices", () => {
    const a = new TokenCost(100, 200, 1, 2);
    const b = new TokenCost(50, 75, 999, 999);
    const sum = a.add(b);
    expect(sum.inputTokens).toBe(150);
    expect(sum.outputTokens).toBe(275);
    expect(sum.inputPricePerMillion).toBe(1);
    expect(sum.outputPricePerMillion).toBe(2);
  });

  it("scales sub-million token counts proportionally", () => {
    const cost = new TokenCost(1_000, 1_000, 10, 20);
    expect(cost.inputCostUsd).toBeCloseTo(0.01);
    expect(cost.outputCostUsd).toBeCloseTo(0.02);
  });
});
