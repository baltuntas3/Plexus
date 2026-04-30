import { extractVariableReferences } from "../variable-references.js";

describe("extractVariableReferences", () => {
  it("returns an empty list when the body has no placeholders", () => {
    expect(extractVariableReferences("Plain text body")).toEqual([]);
  });

  it("extracts a single reference", () => {
    expect(extractVariableReferences("Hello {{name}}")).toEqual(["name"]);
  });

  it("deduplicates while preserving first-occurrence order", () => {
    expect(
      extractVariableReferences("{{topic}} then {{audience}} then {{topic}}"),
    ).toEqual(["topic", "audience"]);
  });

  it("tolerates whitespace inside the braces", () => {
    expect(extractVariableReferences("{{  spaced  }}")).toEqual(["spaced"]);
  });

  it("ignores names that don't match the grammar", () => {
    expect(extractVariableReferences("{{1bad}} {{has-dash}} {{ok_name}}")).toEqual([
      "ok_name",
    ]);
  });

  it("works across multiple matchAll calls (no shared regex state leak)", () => {
    const body = "{{a}} {{b}}";
    expect(extractVariableReferences(body)).toEqual(["a", "b"]);
    expect(extractVariableReferences(body)).toEqual(["a", "b"]);
  });
});
