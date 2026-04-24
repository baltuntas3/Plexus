import { Prompt } from "../../../../domain/entities/prompt.js";
import { BraidAuthorship } from "../../../../domain/value-objects/braid-authorship.js";
import { BraidGraph } from "../../../../domain/value-objects/braid-graph.js";

// The aggregate hands off its save-time state as a PromptSnapshot and
// advances its revision only once the repository confirms the write via
// commit(). Snapshot/commit replaces the earlier dirty-tracking protocol
// that leaked persistence concerns into the aggregate's public surface.

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

describe("Prompt snapshot/commit", () => {
  it("captures root + versions with the advanced revision inside the snapshot", () => {
    const prompt = makePrompt();
    const snapshot = prompt.toSnapshot();
    expect(snapshot.expectedRevision).toBe(0);
    expect(snapshot.nextRevision).toBe(1);
    expect(snapshot.root.revision).toBe(1);
    expect(snapshot.versions.map((v) => v.id)).toEqual(["v1-id"]);
    // Aggregate's own revision is not advanced until commit — an
    // un-persisted snapshot must never move the cursor.
    expect(prompt.revision).toBe(0);
  });

  it("advances the aggregate revision only on commit", () => {
    const prompt = makePrompt();
    const snapshot = prompt.toSnapshot();
    prompt.commit(snapshot);
    expect(prompt.revision).toBe(1);
  });

  it("rejects a stale snapshot whose expected revision no longer matches", () => {
    const prompt = makePrompt();
    const snapshot = prompt.toSnapshot();
    prompt.commit(snapshot);
    // Second snapshot is against rev 1; committing the first again must
    // fail rather than silently walk the cursor backwards.
    expect(() => prompt.commit(snapshot)).toThrow();
  });

  it("includes a new fork in the next snapshot's versions", () => {
    const prompt = makePrompt();
    prompt.commit(prompt.toSnapshot());

    prompt.upsertBraid({
      sourceVersionId: "v1-id",
      graph: GRAPH,
      authorship: BraidAuthorship.byModel("model-a"),
      forkVersionId: "fork-id",
    });

    const snapshot = prompt.toSnapshot();
    expect(snapshot.expectedRevision).toBe(1);
    expect(snapshot.nextRevision).toBe(2);
    expect(snapshot.versions.map((v) => v.id)).toEqual(["v1-id", "fork-id"]);
  });

  it("reflects a status change on an existing version in the next snapshot", () => {
    const prompt = makePrompt();
    prompt.commit(prompt.toSnapshot());
    prompt.promoteVersion("v1-id", "staging");
    const snapshot = prompt.toSnapshot();
    const v1 = snapshot.versions.find((v) => v.id === "v1-id");
    expect(v1?.status).toBe("staging");
  });
});
