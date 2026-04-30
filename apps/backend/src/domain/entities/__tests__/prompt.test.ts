import { Prompt } from "../prompt.js";
import { VersionLabel } from "../../value-objects/version-label.js";

describe("Prompt aggregate", () => {
  const baseParams = {
    promptId: "prompt-1",
    organizationId: "org-1",
    creatorId: "user-1",
    name: "Summarizer",
    description: "summarize text",
    taskType: "general" as const,
  };

  it("rejects an empty name", () => {
    expect(() =>
      Prompt.create({ ...baseParams, name: "   " }),
    ).toThrow(/must not be empty/);
  });

  it("trims the name on create", () => {
    const prompt = Prompt.create({ ...baseParams, name: "  Summarizer  " });
    expect(prompt.name).toBe("Summarizer");
  });

  it("starts with versionCounter=0 and no production pointer", () => {
    const prompt = Prompt.create(baseParams);
    expect(prompt.versionCounter).toBe(0);
    expect(prompt.productionVersionId).toBeNull();
    expect(prompt.revision).toBe(0);
  });

  it("allocates monotonic version labels v1, v2, v3", () => {
    const prompt = Prompt.create(baseParams);
    expect(prompt.allocateNextVersionLabel().toString()).toBe("v1");
    expect(prompt.allocateNextVersionLabel().toString()).toBe("v2");
    expect(prompt.allocateNextVersionLabel().toString()).toBe("v3");
    expect(prompt.versionCounter).toBe(3);
  });

  it("returns VersionLabel instances from allocation", () => {
    const prompt = Prompt.create(baseParams);
    const label = prompt.allocateNextVersionLabel();
    expect(label).toBeInstanceOf(VersionLabel);
  });

  it("setProductionVersion is idempotent", () => {
    const prompt = Prompt.create(baseParams);
    prompt.setProductionVersion("v1-id");
    const updatedAt1 = prompt.updatedAt;
    prompt.setProductionVersion("v1-id");
    expect(prompt.updatedAt).toBe(updatedAt1);
    expect(prompt.isProductionVersion("v1-id")).toBe(true);
  });

  it("clearProductionVersion is idempotent when already null", () => {
    const prompt = Prompt.create(baseParams);
    const updatedAt = prompt.updatedAt;
    prompt.clearProductionVersion();
    expect(prompt.updatedAt).toBe(updatedAt);
  });

  it("toSnapshot exposes the post-write revision and the expected pre-write revision", () => {
    const prompt = Prompt.create(baseParams);
    prompt.allocateNextVersionLabel();
    const snapshot = prompt.toSnapshot();
    expect(snapshot.expectedRevision).toBe(0);
    expect(snapshot.primitives.revision).toBe(1);
    expect(snapshot.primitives.versionCounter).toBe(1);
  });

  it("markPersisted advances the revision to match the just-saved snapshot", () => {
    const prompt = Prompt.create(baseParams);
    const snapshot = prompt.toSnapshot();
    prompt.markPersisted();
    expect(prompt.revision).toBe(snapshot.primitives.revision);
  });

  it("hydrate round-trips primitives", () => {
    const prompt = Prompt.create(baseParams);
    prompt.allocateNextVersionLabel();
    prompt.setProductionVersion("v1-id");
    const snapshot = prompt.toSnapshot();
    const reborn = Prompt.hydrate(snapshot.primitives);
    expect(reborn.id).toBe(prompt.id);
    expect(reborn.versionCounter).toBe(1);
    expect(reborn.productionVersionId).toBe("v1-id");
    expect(reborn.organizationId).toBe(baseParams.organizationId);
  });
});
