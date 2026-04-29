import {
  PromptVariable,
  assertUniqueVariableNames,
} from "../prompt-variable.js";
import { extractVariableReferences } from "../variable-references.js";

describe("PromptVariable", () => {
  it("accepts a valid name", () => {
    const v = PromptVariable.create({ name: "userInput" });
    expect(v.name).toBe("userInput");
    expect(v.required).toBe(false);
  });

  it("rejects names that violate the slug pattern", () => {
    expect(() => PromptVariable.create({ name: "1starts-with-digit" })).toThrow();
    expect(() => PromptVariable.create({ name: "has space" })).toThrow();
    expect(() => PromptVariable.create({ name: "" })).toThrow();
    expect(() => PromptVariable.create({ name: "kebab-case" })).toThrow();
  });

  it("normalizes empty optional fields to null", () => {
    const v = PromptVariable.create({
      name: "x",
      description: "  ",
      defaultValue: "",
    });
    expect(v.description).toBeNull();
    expect(v.defaultValue).toBeNull();
  });

  it("round-trips through toSnapshot/fromSnapshot", () => {
    const original = PromptVariable.create({
      name: "ctx",
      description: "Context block",
      defaultValue: "n/a",
      required: true,
    });
    const restored = PromptVariable.fromSnapshot(original.toSnapshot());
    expect(restored.toSnapshot()).toEqual(original.toSnapshot());
  });

  it("assertUniqueVariableNames rejects duplicates", () => {
    const a = PromptVariable.create({ name: "x" });
    const b = PromptVariable.create({ name: "x" });
    expect(() => assertUniqueVariableNames([a, b])).toThrow(/Duplicate/);
  });
});

describe("extractVariableReferences", () => {
  it("returns deduped names in first-occurrence order", () => {
    const refs = extractVariableReferences(
      "Answer {{question}} given {{ context }}; restate {{question}}.",
    );
    expect(refs).toEqual(["question", "context"]);
  });

  it("ignores text that does not match the placeholder grammar", () => {
    expect(extractVariableReferences("no placeholders here")).toEqual([]);
    expect(extractVariableReferences("{{1bad}} or {{good}}")).toEqual(["good"]);
  });

  it("tolerates whitespace inside braces", () => {
    expect(extractVariableReferences("{{   spaced   }}")).toEqual(["spaced"]);
  });
});
