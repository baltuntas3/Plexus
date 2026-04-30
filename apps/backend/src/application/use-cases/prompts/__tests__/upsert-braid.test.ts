import { PromptVersion } from "../../../../domain/entities/prompt-version.js";
import { Prompt } from "../../../../domain/entities/prompt.js";
import { BraidAuthorship } from "../../../../domain/value-objects/braid-authorship.js";
import { BraidGraph } from "../../../../domain/value-objects/braid-graph.js";

// Fork-on-edit invariant: every graph edit produces a new version linked
// to its parent. Source version content is not touched, so BenchmarkResult
// rows referencing a historical version id resolve to the exact evaluated
// content. After the aggregate split, forking is a PromptVersion.fork
// static that returns a fresh aggregate; the Prompt root only allocates
// the next monotonic label.

const makePromptAndInitialVersion = (): { prompt: Prompt; v1: PromptVersion } => {
  const prompt = Prompt.create({
    promptId: "prompt-1",
    organizationId: "org-1",
    creatorId: "u1",
    name: "p",
    description: "",
    taskType: "general",
  });
  const v1 = PromptVersion.create({
    id: "v1-id",
    promptId: prompt.id,
      organizationId: prompt.organizationId,
    version: prompt.allocateNextVersionLabel(),
    sourcePrompt: "Answer concisely.",
  });
  return { prompt, v1 };
};

const GRAPH_A = BraidGraph.parse("flowchart TD;\nA[start] --> B[Check output];");
const GRAPH_B = BraidGraph.parse("flowchart TD;\nX[begin] --> Y[Verify response];");

describe("PromptVersion.fork", () => {
  it("creates a new version on first braid attachment and leaves source classical", () => {
    const { prompt, v1 } = makePromptAndInitialVersion();
    const forked = PromptVersion.fork({
      source: v1,
      newId: "forked-id-1",
      newLabel: prompt.allocateNextVersionLabel(),
      initialBraid: {
        graph: GRAPH_A,
        authorship: BraidAuthorship.byModel("openai/gpt-oss-120b"),
      },
    });
    expect(forked.version).toBe("v2");
    expect(forked.hasBraidRepresentation).toBe(true);
    expect(forked.parentVersionId).toBe("v1-id");

    expect(v1.hasBraidRepresentation).toBe(false);
    expect(v1.parentVersionId).toBeNull();
  });

  it("forks again on a subsequent braid edit — source braid stays frozen", () => {
    const { prompt, v1 } = makePromptAndInitialVersion();
    const v2 = PromptVersion.fork({
      source: v1,
      newId: "fork-a",
      newLabel: prompt.allocateNextVersionLabel(),
      initialBraid: {
        graph: GRAPH_A,
        authorship: BraidAuthorship.byModel("openai/gpt-oss-120b"),
      },
    });
    const v3 = PromptVersion.fork({
      source: v2,
      newId: "fork-b",
      newLabel: prompt.allocateNextVersionLabel(),
      initialBraid: {
        graph: GRAPH_B,
        authorship: BraidAuthorship.byModel("openai/gpt-oss-120b"),
      },
    });
    expect(v3.version).toBe("v3");
    expect(v3.parentVersionId).toBe(v2.id);
    expect(v3.braidGraph?.mermaidCode).toBe(GRAPH_B.mermaidCode);

    // v2 content is exactly what was originally written — no in-place
    // overwrite even though the user "edited" it downstream.
    expect(v2.braidGraph?.mermaidCode).toBe(GRAPH_A.mermaidCode);
  });

  it("records the model that produced the fork, not the parent's model", () => {
    const { prompt, v1 } = makePromptAndInitialVersion();
    const v2 = PromptVersion.fork({
      source: v1,
      newId: "fork-a",
      newLabel: prompt.allocateNextVersionLabel(),
      initialBraid: {
        graph: GRAPH_A,
        authorship: BraidAuthorship.byModel("model-a"),
      },
    });
    const v3 = PromptVersion.fork({
      source: v2,
      newId: "fork-b",
      newLabel: prompt.allocateNextVersionLabel(),
      initialBraid: {
        graph: GRAPH_B,
        authorship: BraidAuthorship.byModel("model-b"),
      },
    });
    expect(v2.braidAuthorship?.kind).toBe("model");
    expect(v2.generatorModel).toBe("model-a");
    expect(v3.braidAuthorship?.kind).toBe("model");
    expect(v3.generatorModel).toBe("model-b");
    expect(v3.parentVersionId).toBe(v2.id);
  });

  it("distinguishes manual edits from LLM-authored graphs", () => {
    const { prompt, v1 } = makePromptAndInitialVersion();
    const v2 = PromptVersion.fork({
      source: v1,
      newId: "fork-a",
      newLabel: prompt.allocateNextVersionLabel(),
      initialBraid: {
        graph: GRAPH_A,
        authorship: BraidAuthorship.byModel("model-a"),
      },
    });
    const v3 = PromptVersion.fork({
      source: v2,
      newId: "fork-b",
      newLabel: prompt.allocateNextVersionLabel(),
      initialBraid: {
        graph: GRAPH_B,
        authorship: BraidAuthorship.manual(v2.generatorModel),
      },
    });
    expect(v3.braidAuthorship?.kind).toBe("manual");
    expect(v3.braidAuthorship?.toSnapshot()).toEqual({
      kind: "manual",
      derivedFromModel: "model-a",
    });
    expect(v3.generatorModel).toBe("model-a");
  });
});
