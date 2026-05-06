import { buildEvaluationPrompt } from "../evaluation-prompt.js";
import type { PromptVersionSummary } from "../../../queries/prompt-query-service.js";

const summary = (executablePrompt: string): PromptVersionSummary => ({
  id: "v1",
  promptId: "p1",
  version: "v1",
  name: null,
  parentVersionId: null,
  sourcePrompt: "",
  braidGraph: null,
  braidGraphLayout: null,
  braidAuthorship: null,
  generatorModel: null,
  variables: [],
  executablePrompt,
  status: "draft",
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe("buildEvaluationPrompt", () => {
  it("returns classical prompts unchanged", () => {
    const prompt = "You are a helpful assistant. Answer in JSON.";
    expect(buildEvaluationPrompt(summary(prompt))).toBe(prompt);
  });

  it("wraps a flowchart-TD BRAID graph with runtime execution instructions", () => {
    const graph = "flowchart TD;\nA[Start] --> B[End];";
    const result = buildEvaluationPrompt(summary(graph));
    expect(result).toContain("OUTPUT ONLY THE FINAL RESULT");
    expect(result).toContain(graph);
    expect(result).toContain("consumed by another program");
    // Wrapper must come BEFORE the graph so the model reads its job first.
    expect(result.indexOf("OUTPUT ONLY THE FINAL RESULT")).toBeLessThan(
      result.indexOf(graph),
    );
  });

  it("also wraps the legacy 'graph TD' header form", () => {
    const graph = "graph TD;\nA --> B;";
    const result = buildEvaluationPrompt(summary(graph));
    expect(result).toContain("OUTPUT ONLY THE FINAL RESULT");
    expect(result).toContain(graph);
  });

  it("does not misclassify classical prompts that mention 'flowchart' mid-text", () => {
    // A prompt that talks ABOUT flowcharts in its instructions, but is
    // itself plain text, must not be wrapped — the BRAID runtime spec
    // would be wrong for a non-graph prompt.
    const prompt = "Help the user draw a flowchart of their reasoning.";
    expect(buildEvaluationPrompt(summary(prompt))).toBe(prompt);
  });

  it("applies the same wrapper to every BRAID version (no version-specific text)", () => {
    const a = buildEvaluationPrompt(summary("flowchart TD;\nA[X] --> B[Y];"));
    const b = buildEvaluationPrompt(summary("flowchart TD;\nM[Foo] --> N[Bar];"));
    // Strip the embedded graph; what remains is the wrapper, which must
    // be byte-identical so no BRAID version receives extra help.
    const wrapperA = a.replace("flowchart TD;\nA[X] --> B[Y];", "<graph>");
    const wrapperB = b.replace("flowchart TD;\nM[Foo] --> N[Bar];", "<graph>");
    expect(wrapperA).toBe(wrapperB);
  });
});
