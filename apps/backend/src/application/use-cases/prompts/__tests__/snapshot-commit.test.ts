import { Prompt } from "../../../../domain/entities/prompt.js";
import { PromptVersion } from "../../../../domain/entities/prompt-version.js";

// Snapshot/markPersisted protocol for the two write aggregates: snapshot
// carries the post-write primitives and the expected revision used as the
// optimistic-concurrency guard at the repo; markPersisted advances the
// in-memory cursor only after the repo confirms a successful write.

const makePrompt = (): Prompt =>
  Prompt.create({
    promptId: "prompt-1",
    ownerId: "u1",
    name: "p",
    description: "",
    taskType: "general",
  });

describe("Prompt snapshot/markPersisted", () => {
  it("snapshots expected=current, primitives.revision=current+1, advances on markPersisted", () => {
    const prompt = makePrompt();
    const snapshot = prompt.toSnapshot();
    expect(snapshot.expectedRevision).toBe(0);
    expect(snapshot.primitives.revision).toBe(1);
    // Aggregate's own revision is not advanced until markPersisted — an
    // un-persisted snapshot must never move the cursor.
    expect(prompt.revision).toBe(0);
    prompt.markPersisted();
    expect(prompt.revision).toBe(1);
  });

  it("reflects allocateNextVersionLabel in subsequent snapshots", () => {
    const prompt = makePrompt();
    const first = prompt.allocateNextVersionLabel();
    expect(first.toString()).toBe("v1");
    const snapshot = prompt.toSnapshot();
    expect(snapshot.primitives.versionCounter).toBe(1);

    prompt.markPersisted();
    const second = prompt.allocateNextVersionLabel();
    expect(second.toString()).toBe("v2");
    expect(prompt.toSnapshot().primitives.versionCounter).toBe(2);
  });
});

describe("PromptVersion snapshot/markPersisted", () => {
  const makeVersion = (): PromptVersion => {
    const prompt = makePrompt();
    const label = prompt.allocateNextVersionLabel();
    return PromptVersion.create({
      id: "v1-id",
      promptId: prompt.id,
      version: label,
      sourcePrompt: "Answer concisely.",
    });
  };

  it("advances the version revision only on markPersisted", () => {
    const version = makeVersion();
    const snapshot = version.toSnapshot();
    expect(snapshot.expectedRevision).toBe(0);
    expect(snapshot.primitives.revision).toBe(1);
    expect(version.revision).toBe(0);
    version.markPersisted();
    expect(version.revision).toBe(1);
  });
});
