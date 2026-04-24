import { Prompt } from "../../../../domain/entities/prompt.js";
import { BraidGraph } from "../../../../domain/value-objects/braid-graph.js";

// Immutability invariant: every graph edit produces a new forked version
// linked to its parent. The source version's content is not touched, so
// BenchmarkResult rows that reference a historical version id always
// resolve to the exact content that was evaluated.

const makePrompt = (): Prompt =>
  Prompt.create({
    promptId: "prompt-1",
    initialVersionId: "v1-id",
    ownerId: "u1",
    name: "p",
    description: "",
    taskType: "general",
    initialPrompt: "Answer concisely.",
  });

const GRAPH_A = BraidGraph.parse("flowchart TD;\nA[start] --> B[Check output];");
const GRAPH_B = BraidGraph.parse("flowchart TD;\nX[begin] --> Y[Verify response];");

describe("Prompt.upsertBraid (fork-on-edit)", () => {
  it("creates a new version on first braid attachment and keeps source classical", () => {
    const prompt = makePrompt();
    const forked = prompt.upsertBraid({
      version: "v1",
      graph: GRAPH_A,
      generatorModel: "openai/gpt-oss-120b",
      forkVersionId: "forked-id-1",
    });
    expect(forked.version).toBe("v2");
    expect(forked.hasBraidRepresentation).toBe(true);
    expect(forked.parentVersionId).toBe("v1-id");

    const v1 = prompt.getVersionOrThrow("v1");
    expect(v1.hasBraidRepresentation).toBe(false);
    expect(v1.parentVersionId).toBeNull();
  });

  it("forks again on a subsequent braid edit — source braid stays frozen", () => {
    const prompt = makePrompt();
    const v2 = prompt.upsertBraid({
      version: "v1",
      graph: GRAPH_A,
      generatorModel: "openai/gpt-oss-120b",
      forkVersionId: "fork-a",
    });
    const v3 = prompt.upsertBraid({
      version: v2.version,
      graph: GRAPH_B,
      generatorModel: "openai/gpt-oss-120b",
      forkVersionId: "fork-b",
    });
    expect(v3.version).toBe("v3");
    expect(v3.parentVersionId).toBe(v2.id);
    expect(v3.braidGraph?.mermaidCode).toBe(GRAPH_B.mermaidCode);

    // Source v2 must be exactly what was originally written — no in-place
    // overwrite even though the user "edited" it.
    const reloadedV2 = prompt.getVersionOrThrow("v2");
    expect(reloadedV2.braidGraph?.mermaidCode).toBe(GRAPH_A.mermaidCode);
    expect(reloadedV2.id).toBe(v2.id);
  });

  it("records the model that produced the fork, not the parent's model", () => {
    // Provenance invariant: generatorModel on a fork is whichever model
    // actually generated the content the fork carries. Parent's model is
    // the parent's history (reachable via parentVersionId); it must not
    // leak into the child's metadata when the child was built by a
    // different model.
    const prompt = makePrompt();
    const v2 = prompt.upsertBraid({
      version: "v1",
      graph: GRAPH_A,
      generatorModel: "model-a",
      forkVersionId: "fork-a",
    });
    const v3 = prompt.upsertBraid({
      version: v2.version,
      graph: GRAPH_B,
      generatorModel: "model-b",
      forkVersionId: "fork-b",
    });
    expect(v2.generatorModel).toBe("model-a");
    expect(v3.generatorModel).toBe("model-b");
    expect(v3.parentVersionId).toBe(v2.id);
  });
});
