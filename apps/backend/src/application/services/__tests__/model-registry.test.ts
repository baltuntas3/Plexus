import { ModelRegistry, calculateCost } from "../model-registry.js";
import { DomainError } from "../../../domain/errors/domain-error.js";

describe("ModelRegistry", () => {
  it("lookup returns null for unknown model", () => {
    expect(ModelRegistry.lookup("nonexistent-model")).toBeNull();
  });

  it("require throws DomainError for unknown model", () => {
    expect(() => ModelRegistry.require("nonexistent-model")).toThrow(DomainError);
  });

  it("byProvider filters groq models", () => {
    const groq = ModelRegistry.byProvider("groq");
    expect(groq.length).toBe(3);
    expect(groq.every((m) => m.provider === "groq")).toBe(true);
  });

  it("list returns all 3 groq models", () => {
    const all = ModelRegistry.list();
    expect(all.length).toBe(3);
    expect(all.every((m) => m.provider === "groq")).toBe(true);
  });
});

describe("calculateCost", () => {
  it("uses pricing from the registry entry", () => {
    const info = ModelRegistry.require("llama-3.3-70b-versatile");
    const cost = calculateCost("llama-3.3-70b-versatile", 1_000_000, 0);
    expect(cost.totalUsd).toBeCloseTo(info.inputPricePerMillion);
  });

  it("throws for unknown model", () => {
    expect(() => calculateCost("unknown", 100, 100)).toThrow(DomainError);
  });
});
