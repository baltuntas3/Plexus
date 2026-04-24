import { Prompt } from "../../../../domain/entities/prompt.js";

// Classical authoring path. A fresh `createVersion` without `fromVersionId`
// produces a root; with `fromVersionId` it forks from the named ancestor so
// classical prompt evolution carries the same lineage invariant as BRAID
// fork-on-edit. The aggregate resolves the id itself — a phantom parent is
// rejected at the boundary, not silently accepted.

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

describe("Prompt.createVersion", () => {
  it("creates a root version when no ancestor is supplied", () => {
    const prompt = makePrompt();
    const v2 = prompt.createVersion({
      id: "v2-id",
      sourcePrompt: "Answer in one sentence.",
    });
    expect(v2.version).toBe("v2");
    expect(v2.parentVersionId).toBeNull();
    expect(v2.hasBraidRepresentation).toBe(false);
  });

  it("records parentVersionId when forking from an existing version", () => {
    const prompt = makePrompt();
    const v1 = prompt.getVersionByLabelOrThrow("v1");
    const v2 = prompt.createVersion({
      id: "v2-id",
      sourcePrompt: "Answer in one sentence.",
      fromVersionId: v1.id,
    });
    expect(v2.parentVersionId).toBe(v1.id);

    const v1Reloaded = prompt.getVersionByLabelOrThrow("v1");
    expect(v1Reloaded.sourcePrompt).toBe("Answer concisely.");
  });

  it("throws when the ancestor id does not belong to this aggregate", () => {
    const prompt = makePrompt();
    expect(() =>
      prompt.createVersion({
        id: "v2-id",
        sourcePrompt: "x",
        fromVersionId: "not-a-real-id",
      }),
    ).toThrow();
  });
});
