import { PromptVersion } from "../../../../domain/entities/prompt-version.js";
import { BraidAuthorship } from "../../../../domain/value-objects/braid-authorship.js";
import { BraidGraph } from "../../../../domain/value-objects/braid-graph.js";
import { CreatePromptUseCase } from "../create-prompt.js";
import { UpdateBraidGraphLayoutUseCase } from "../update-braid-graph-layout.js";
import { InMemoryIdGenerator } from "../../../../__tests__/fakes/in-memory-id-generator.js";
import { InMemoryPromptAggregateRepository } from "../../../../__tests__/fakes/in-memory-prompt-aggregate-repository.js";
import { InMemoryPromptVersionRepository } from "../../../../__tests__/fakes/in-memory-prompt-version-repository.js";
import { NoOpUnitOfWork } from "../../../../__tests__/fakes/no-op-unit-of-work.js";

const organizationId = "org-1";
const userId = "u-1";

const seedMermaid = [
  "flowchart TD;",
  "  Start[Read input];",
  "  Plan[Plan steps];",
  "  Check[Verify result];",
  "  Start --> Plan;",
  "  Plan --> Check;",
].join("\n");

const setup = async () => {
  const prompts = new InMemoryPromptAggregateRepository();
  const versions = new InMemoryPromptVersionRepository();
  const ids = new InMemoryIdGenerator();
  const uow = new NoOpUnitOfWork();

  const createPrompt = new CreatePromptUseCase(prompts, versions, ids, uow);
  const { prompt, version: v1 } = await createPrompt.execute({
    organizationId,
    userId,
    name: "Workflow",
    description: "",
    taskType: "general",
    initialPrompt: "Process the input.",
  });

  const promptAggregate = await prompts.findInOrganization(prompt.id, organizationId);
  const v1Aggregate = await versions.findByPromptAndLabelInOrganization(
    prompt.id,
    v1.version,
    organizationId,
  );
  if (!promptAggregate || !v1Aggregate) throw new Error("seed failed");

  // Fork v2 with a real braid graph so the layout endpoint has
  // somewhere to attach. Layout for a classical version is rejected.
  const seeded = PromptVersion.fork({
    source: v1Aggregate,
    newId: ids.newId(),
    newLabel: promptAggregate.allocateNextVersionLabel(),
    initialBraid: {
      graph: BraidGraph.parse(seedMermaid),
      authorship: BraidAuthorship.byModel("test-model"),
    },
  });
  await versions.save(seeded);
  await prompts.save(promptAggregate);

  return {
    promptId: prompt.id,
    classicalVersion: v1.version,
    braidVersion: seeded.version,
    versions,
    update: new UpdateBraidGraphLayoutUseCase(prompts, versions),
  };
};

describe("UpdateBraidGraphLayoutUseCase", () => {
  it("persists positions in place — same version, no fork", async () => {
    const { promptId, braidVersion, versions, update } = await setup();
    const before = await versions.findByPromptAndLabelInOrganization(
      promptId,
      braidVersion,
      organizationId,
    );
    expect(before?.braidGraphLayout).toBeNull();

    await update.execute({
      promptId,
      version: braidVersion,
      organizationId,
      userId,
      positions: [
        { nodeId: "Start", x: 0, y: 0 },
        { nodeId: "Plan", x: 200, y: 100 },
      ],
    });

    const after = await versions.findByPromptAndLabelInOrganization(
      promptId,
      braidVersion,
      organizationId,
    );
    // Same version label — no fork (layout is presentation metadata).
    expect(after?.version).toBe(braidVersion);
    expect(after?.braidGraphLayout?.size).toBe(2);
    expect(after?.braidGraphLayout?.positionOf("Plan")).toEqual({ x: 200, y: 100 });
  });

  it("clears the saved layout when positions is empty", async () => {
    const { promptId, braidVersion, versions, update } = await setup();
    await update.execute({
      promptId,
      version: braidVersion,
      organizationId,
      userId,
      positions: [{ nodeId: "Start", x: 10, y: 10 }],
    });
    await update.execute({
      promptId,
      version: braidVersion,
      organizationId,
      userId,
      positions: [],
    });
    const v = await versions.findByPromptAndLabelInOrganization(
      promptId,
      braidVersion,
      organizationId,
    );
    expect(v?.braidGraphLayout).toBeNull();
  });

  it("rejects layout for a version with no BRAID graph", async () => {
    const { promptId, classicalVersion, update } = await setup();
    await expect(
      update.execute({
        promptId,
        version: classicalVersion,
        organizationId,
        userId,
        positions: [{ nodeId: "A", x: 0, y: 0 }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("collapses cross-org promptIds to PROMPT_NOT_FOUND", async () => {
    const { promptId, braidVersion, update } = await setup();
    await expect(
      update.execute({
        promptId,
        version: braidVersion,
        organizationId: "other-org",
        userId,
        positions: [],
      }),
    ).rejects.toMatchObject({ code: "PROMPT_NOT_FOUND" });
  });

  it("rejects positions with malformed nodeIds via the layout VO", async () => {
    const { promptId, braidVersion, update } = await setup();
    await expect(
      update.execute({
        promptId,
        version: braidVersion,
        organizationId,
        userId,
        positions: [{ nodeId: "1bad", x: 0, y: 0 }],
      }),
    ).rejects.toThrow(/Invalid layout nodeId/);
  });

  it("rejects positions referencing nodes that aren't in the version's graph", async () => {
    // Defense-in-depth: stale frontend state or a buggy client could
    // try to save a position for a node that was never in (or was
    // structurally removed from) the graph. Surfacing the mismatch
    // makes the bug visible rather than silently persisting orphans.
    const { promptId, braidVersion, update } = await setup();
    await expect(
      update.execute({
        promptId,
        version: braidVersion,
        organizationId,
        userId,
        positions: [
          { nodeId: "Start", x: 0, y: 0 },
          { nodeId: "GhostNode", x: 100, y: 100 },
        ],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
