import { PromptVersion } from "../prompt-version.js";
import { PromptVariable } from "../../value-objects/prompt-variable.js";
import { VersionLabel } from "../../value-objects/version-label.js";

const params = {
  id: "v-1",
  promptId: "prompt-1",
  organizationId: "org-1",
  version: VersionLabel.fromSequence(1),
  sourcePrompt: "Tell me a joke",
};

describe("PromptVersion aggregate", () => {
  it("starts in draft status with no parent and no braid", () => {
    const v = PromptVersion.create(params);
    expect(v.status).toBe("draft");
    expect(v.parentVersionId).toBeNull();
    expect(v.hasBraidRepresentation).toBe(false);
    expect(v.braidGraph).toBeNull();
  });

  it("rejects an empty source prompt", () => {
    expect(() =>
      PromptVersion.create({ ...params, sourcePrompt: "   " }),
    ).toThrow(/PROMPT_SOURCE_EMPTY|empty/);
  });

  it("treats blank or whitespace names as null", () => {
    const v = PromptVersion.create({ ...params, name: "  " });
    expect(v.name).toBeNull();
    v.rename("first cut");
    expect(v.name).toBe("first cut");
    v.rename(null);
    expect(v.name).toBeNull();
  });

  it("rejects duplicate variable names at create time", () => {
    expect(() =>
      PromptVersion.create({
        ...params,
        variables: [
          PromptVariable.create({ name: "topic" }),
          PromptVariable.create({ name: "topic" }),
        ],
      }),
    ).toThrow(/Duplicate variable name/);
  });

  it("forbids transitions back to draft", () => {
    const v = PromptVersion.create(params);
    v.changeStatus("staging");
    expect(() => v.changeStatus("draft")).toThrow(
      /PROMPT_INVALID_VERSION_TRANSITION|Cannot move version/,
    );
  });

  it("allows draft → development → staging → production and back to staging", () => {
    const v = PromptVersion.create(params);
    v.changeStatus("development");
    expect(v.status).toBe("development");
    v.changeStatus("staging");
    v.changeStatus("production");
    v.changeStatus("staging");
    expect(v.status).toBe("staging");
  });

  it("changeStatus is a no-op when target equals current status", () => {
    const v = PromptVersion.create(params);
    v.changeStatus("staging");
    const updatedAt = v.updatedAt;
    v.changeStatus("staging");
    expect(v.updatedAt).toBe(updatedAt);
  });

  it("fork inherits org, promptId, parent pointer, and variables", () => {
    const source = PromptVersion.create({
      ...params,
      variables: [PromptVariable.create({ name: "topic" })],
    });
    const forked = PromptVersion.fork({
      source,
      newId: "v-2",
      newLabel: VersionLabel.fromSequence(2),
    });
    expect(forked.parentVersionId).toBe(source.id);
    expect(forked.promptId).toBe(source.promptId);
    expect(forked.organizationId).toBe(source.organizationId);
    expect(forked.variables.map((v) => v.name)).toEqual(["topic"]);
    expect(forked.status).toBe("draft");
  });

  it("fork can override variables", () => {
    const source = PromptVersion.create(params);
    const forked = PromptVersion.fork({
      source,
      newId: "v-2",
      newLabel: VersionLabel.fromSequence(2),
      variables: [PromptVariable.create({ name: "audience" })],
    });
    expect(forked.variables.map((v) => v.name)).toEqual(["audience"]);
  });

  it("toSnapshot bumps revision and round-trips through hydrate", () => {
    const v = PromptVersion.create(params);
    v.changeStatus("staging");
    const snap = v.toSnapshot();
    expect(snap.expectedRevision).toBe(0);
    expect(snap.primitives.revision).toBe(1);
    const reborn = PromptVersion.hydrate(snap.primitives);
    expect(reborn.status).toBe("staging");
    expect(reborn.organizationId).toBe(params.organizationId);
  });

  it("hydrate rejects malformed version labels", () => {
    expect(() =>
      PromptVersion.hydrate({
        id: "v-1",
        promptId: "p-1",
        organizationId: "o-1",
        version: "vee-1",
        name: null,
        parentVersionId: null,
        sourcePrompt: "x",
        representation: { kind: "classical" },
        variables: [],
        braidGraphLayout: null,
        status: "draft",
        revision: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).toThrow(/Invalid version label/);
  });
});
