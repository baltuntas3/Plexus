import type { PromptVariableDto } from "@plexus/shared-types";
import { computeVariablesDiff } from "../variables-diff.js";

const v = (
  name: string,
  overrides: Partial<PromptVariableDto> = {},
): PromptVariableDto => ({
  name,
  description: null,
  defaultValue: null,
  required: false,
  ...overrides,
});

describe("computeVariablesDiff", () => {
  it("partitions names into added / removed / changed / unchanged", () => {
    const base = [v("a"), v("b", { defaultValue: "x" }), v("c")];
    const target = [v("a"), v("b", { defaultValue: "y" }), v("d")];
    const diff = computeVariablesDiff(base, target);

    expect(diff.added.map((x) => x.name)).toEqual(["d"]);
    expect(diff.removed.map((x) => x.name)).toEqual(["c"]);
    expect(diff.changed.map((x) => x.name)).toEqual(["b"]);
    expect(diff.unchanged.map((x) => x.name)).toEqual(["a"]);
  });

  it("captures the per-field change in `changed.base`/`changed.target`", () => {
    const base = [v("name", { description: "old", required: false })];
    const target = [v("name", { description: "new", required: true })];
    const diff = computeVariablesDiff(base, target);

    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]?.base.description).toBe("old");
    expect(diff.changed[0]?.target.description).toBe("new");
    expect(diff.changed[0]?.base.required).toBe(false);
    expect(diff.changed[0]?.target.required).toBe(true);
  });

  it("models a rename as removed+added rather than changed", () => {
    const base = [v("oldName", { defaultValue: "x" })];
    const target = [v("newName", { defaultValue: "x" })];
    const diff = computeVariablesDiff(base, target);

    expect(diff.removed.map((x) => x.name)).toEqual(["oldName"]);
    expect(diff.added.map((x) => x.name)).toEqual(["newName"]);
    expect(diff.changed).toEqual([]);
    expect(diff.unchanged).toEqual([]);
  });

  it("handles empty inputs", () => {
    const diff = computeVariablesDiff([], []);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.unchanged).toEqual([]);
  });

  it("treats null/undefined description differences as unequal", () => {
    const base = [v("x", { description: null })];
    const target = [v("x", { description: "" })];
    const diff = computeVariablesDiff(base, target);
    // Empty string and null differ; the diff catches this so the UI
    // surfaces what the API treats as distinct values.
    expect(diff.changed.map((x) => x.name)).toEqual(["x"]);
  });
});
