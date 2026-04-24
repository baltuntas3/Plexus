import { Prompt } from "../../../../domain/entities/prompt.js";
import { BraidAuthorship } from "../../../../domain/value-objects/braid-authorship.js";
import { BraidGraph } from "../../../../domain/value-objects/braid-graph.js";

// The aggregate tracks which version ids changed since the last save so the
// repository can write only those. In a world where PromptVersion content
// is immutable and every edit forks a new version, naively rewriting every
// version on every save would burn O(|versions|) writes per edit.

const GRAPH = BraidGraph.parse("flowchart TD;\nA[start] --> B[Check output];");

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

describe("Prompt dirty version tracking", () => {
  it("flags the initial version on a fresh aggregate", () => {
    const prompt = makePrompt();
    expect([...prompt.pullDirtyVersionIds()]).toEqual(["v1-id"]);
  });

  it("clears the set on drain and stays empty on a no-op", () => {
    const prompt = makePrompt();
    prompt.pullDirtyVersionIds();
    expect([...prompt.pullDirtyVersionIds()]).toEqual([]);
  });

  it("flags only the new fork, not existing history", () => {
    const prompt = makePrompt();
    prompt.pullDirtyVersionIds();

    prompt.upsertBraid({
      version: "v1",
      graph: GRAPH,
      authorship: BraidAuthorship.byModel("model-a"),
      forkVersionId: "fork-id",
    });

    expect([...prompt.pullDirtyVersionIds()]).toEqual(["fork-id"]);
  });

  it("flags the target and the demoted prior production on promotion", () => {
    const prompt = makePrompt();
    prompt.pullDirtyVersionIds();

    const v2 = prompt.upsertBraid({
      version: "v1",
      graph: GRAPH,
      authorship: BraidAuthorship.byModel("model-a"),
      forkVersionId: "v2-id",
    });
    prompt.promoteVersion(v2.version, "production");
    prompt.pullDirtyVersionIds();

    const v3 = prompt.upsertBraid({
      version: v2.version,
      graph: GRAPH,
      authorship: BraidAuthorship.byModel("model-a"),
      forkVersionId: "v3-id",
    });
    prompt.pullDirtyVersionIds();

    prompt.promoteVersion(v3.version, "production");
    // v2 must be re-persisted to reflect its demotion to staging; without
    // that the store would keep two rows both claiming status "production".
    expect(new Set(prompt.pullDirtyVersionIds())).toEqual(
      new Set(["v2-id", "v3-id"]),
    );
  });

  it("advances revision only after markPersisted", () => {
    const prompt = makePrompt();
    expect(prompt.revision).toBe(0);
    prompt.markPersisted(1);
    expect(prompt.revision).toBe(1);
  });
});
