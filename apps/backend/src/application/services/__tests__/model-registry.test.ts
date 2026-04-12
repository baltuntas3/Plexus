import { ModelRegistry, calculateCost } from "../model-registry.js";
import { DomainError } from "../../../domain/errors/domain-error.js";

describe("ModelRegistry", () => {
  it("lookup returns null for unknown model", () => {
    expect(ModelRegistry.lookup("nonexistent-model")).toBeNull();
  });

  it("require throws DomainError for unknown model", () => {
    expect(() => ModelRegistry.require("nonexistent-model")).toThrow(DomainError);
  });

  it("byProvider filters models", () => {
    const openai = ModelRegistry.byProvider("openai");
    expect(openai.length).toBeGreaterThan(0);
    expect(openai.every((m) => m.provider === "openai")).toBe(true);

    const anthropic = ModelRegistry.byProvider("anthropic");
    expect(anthropic.every((m) => m.provider === "anthropic")).toBe(true);
  });

  it("list returns all models across providers", () => {
    const all = ModelRegistry.list();
    const sum =
      ModelRegistry.byProvider("openai").length +
      ModelRegistry.byProvider("anthropic").length +
      ModelRegistry.byProvider("groq").length;
    expect(all.length).toBe(sum);
  });
});

describe("calculateCost", () => {
  it("uses pricing from the registry entry", () => {
    const info = ModelRegistry.require("gpt-4o");
    const cost = calculateCost("gpt-4o", 1_000_000, 0);
    expect(cost.totalUsd).toBeCloseTo(info.inputPricePerMillion);
  });

  it("throws for unknown model", () => {
    expect(() => calculateCost("unknown", 100, 100)).toThrow(DomainError);
  });
});
