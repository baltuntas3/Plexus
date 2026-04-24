import { Prompt } from "../../../../domain/entities/prompt.js";
import { PromptVersion } from "../../../../domain/entities/prompt-version.js";

// Prompt and PromptVersion are independent aggregates, each with its own
// snapshot/commit protocol. The test covers both: revision advancement on
// commit, stale-snapshot rejection, and that a prompt's versionCounter
// advances atomically with the root snapshot.

const makePrompt = (): Prompt =>
  Prompt.create({
    promptId: "prompt-1",
    ownerId: "u1",
    name: "p",
    description: "",
    taskType: "general",
  });

describe("Prompt snapshot/commit", () => {
  it("starts at revision 0 and advances to 1 on commit", () => {
    const prompt = makePrompt();
    const snapshot = prompt.toSnapshot();
    expect(snapshot.expectedRevision).toBe(0);
    expect(snapshot.nextRevision).toBe(1);
    expect(snapshot.root.revision).toBe(1);
    // Aggregate's own revision is not advanced until commit — an
    // un-persisted snapshot must never move the cursor.
    expect(prompt.revision).toBe(0);
    prompt.commit(snapshot);
    expect(prompt.revision).toBe(1);
  });

  it("rejects a stale snapshot whose expected revision no longer matches", () => {
    const prompt = makePrompt();
    const snapshot = prompt.toSnapshot();
    prompt.commit(snapshot);
    expect(() => prompt.commit(snapshot)).toThrow();
  });

  it("reflects allocateNextVersionLabel in subsequent snapshots", () => {
    const prompt = makePrompt();
    const first = prompt.allocateNextVersionLabel();
    expect(first.toString()).toBe("v1");
    const snapshot = prompt.toSnapshot();
    expect(snapshot.root.versionCounter).toBe(1);

    prompt.commit(snapshot);
    const second = prompt.allocateNextVersionLabel();
    expect(second.toString()).toBe("v2");
    expect(prompt.toSnapshot().root.versionCounter).toBe(2);
  });
});

describe("PromptVersion snapshot/commit", () => {
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

  it("advances the version revision only on commit", () => {
    const version = makeVersion();
    const snapshot = version.toSnapshot();
    expect(snapshot.expectedRevision).toBe(0);
    expect(snapshot.nextRevision).toBe(1);
    expect(version.revision).toBe(0);
    version.commit(snapshot);
    expect(version.revision).toBe(1);
  });

  it("rejects a stale version snapshot", () => {
    const version = makeVersion();
    const snapshot = version.toSnapshot();
    version.commit(snapshot);
    expect(() => version.commit(snapshot)).toThrow();
  });
});
