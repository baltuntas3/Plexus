import { PromptVersion } from "../../../../domain/entities/prompt-version.js";
import { BraidAuthorship } from "../../../../domain/value-objects/braid-authorship.js";
import { BraidGraph } from "../../../../domain/value-objects/braid-graph.js";
import { CreatePromptUseCase } from "../create-prompt.js";
import {
  AddBraidEdgeUseCase,
  AddBraidNodeUseCase,
  RelabelBraidEdgeUseCase,
  RemoveBraidEdgeUseCase,
  RemoveBraidNodeUseCase,
  RenameBraidNodeUseCase,
} from "../edit-braid-primitives.js";
import { createDefaultGraphLinter } from "../../../services/braid/lint/default-graph-linter.js";
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
  "  Fix[Revise on fail];",
  "  Start --> Plan;",
  "  Plan --> Check;",
  `  Check -- "fail" --> Fix;`,
  "  Fix --> Check;",
].join("\n");

const setup = async () => {
  const prompts = new InMemoryPromptAggregateRepository();
  const versions = new InMemoryPromptVersionRepository();
  const ids = new InMemoryIdGenerator();
  const uow = new NoOpUnitOfWork();
  const linter = createDefaultGraphLinter();

  const createPrompt = new CreatePromptUseCase(prompts, versions, ids, uow);
  const { prompt, version: v1 } = await createPrompt.execute({
    organizationId,
    userId,
    name: "Workflow",
    description: "",
    taskType: "general",
    initialPrompt: "Process the input.",
  });

  // Seed v2 with a real braid graph so structural edits have something
  // to operate on. We fork manually rather than going through the
  // generate-braid use case to avoid mocking the AI provider for what
  // is purely test-fixture setup.
  const promptAggregate = await prompts.findInOrganization(prompt.id, organizationId);
  const v1Aggregate = await versions.findByPromptAndLabelInOrganization(
    prompt.id,
    v1.version,
    organizationId,
  );
  if (!promptAggregate || !v1Aggregate) {
    throw new Error("Prompt or v1 was not persisted");
  }
  const seedGraph = BraidGraph.parse(seedMermaid);
  const seededLabel = promptAggregate.allocateNextVersionLabel();
  const seeded = PromptVersion.fork({
    source: v1Aggregate,
    newId: ids.newId(),
    newLabel: seededLabel,
    initialBraid: {
      graph: seedGraph,
      authorship: BraidAuthorship.byModel("test-model"),
    },
  });
  await versions.save(seeded);
  await prompts.save(promptAggregate);

  const deps = { prompts, versions, linter, idGenerator: ids, uow };
  return {
    promptId: prompt.id,
    seedVersion: seeded.version,
    versions,
    rename: new RenameBraidNodeUseCase(deps),
    addNode: new AddBraidNodeUseCase(deps),
    removeNode: new RemoveBraidNodeUseCase(deps),
    addEdge: new AddBraidEdgeUseCase(deps),
    removeEdge: new RemoveBraidEdgeUseCase(deps),
    relabelEdge: new RelabelBraidEdgeUseCase(deps),
  };
};

describe("RenameBraidNodeUseCase", () => {
  it("forks a draft version with the renamed node", async () => {
    const { promptId, seedVersion, rename, versions } = await setup();
    const result = await rename.execute({
      promptId,
      version: seedVersion,
      organizationId,
      nodeId: "Plan",
      newLabel: "Outline plan",
    });

    const forked = await versions.findByPromptAndLabelInOrganization(
      promptId,
      result.newVersion,
      organizationId,
    );
    expect(forked?.braidGraph?.mermaidCode).toContain("Plan[Outline plan]");
    expect(forked?.braidAuthorship?.toSnapshot().kind).toBe("manual");
    expect(forked?.status).toBe("draft");
  });

  it("rejects renaming a node that does not exist on the source graph", async () => {
    const { promptId, seedVersion, rename } = await setup();
    await expect(
      rename.execute({
        promptId,
        version: seedVersion,
        organizationId,
        nodeId: "DoesNotExist",
        newLabel: "x",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("AddBraidNodeUseCase", () => {
  it("forks with the new node and returns its auto-generated id", async () => {
    const { promptId, seedVersion, addNode, versions } = await setup();
    const result = await addNode.execute({
      promptId,
      version: seedVersion,
      organizationId,
      label: "Notify",
      kind: "step",
    });
    expect(result.nodeId).toMatch(/^N\d+$/);

    const forked = await versions.findByPromptAndLabelInOrganization(
      promptId,
      result.newVersion,
      organizationId,
    );
    expect(forked?.braidGraph?.nodes.some((n) => n.id === result.nodeId)).toBe(true);
  });

  it("declares variables introduced by the label via `addVariables`", async () => {
    // The label `Process {{topic}}` references a variable that doesn't
    // exist on the source. Without `addVariables` the variable-
    // integrity check would reject. With `addVariables: [{ name:
    // "topic" }]` the fork carries the merged list and accepts the
    // reference.
    const { promptId, seedVersion, addNode, versions } = await setup();
    const result = await addNode.execute({
      promptId,
      version: seedVersion,
      organizationId,
      label: "Process {{topic}}",
      kind: "step",
      addVariables: [{ name: "topic" }],
    });
    const forked = await versions.findByPromptAndLabelInOrganization(
      promptId,
      result.newVersion,
      organizationId,
    );
    expect(forked?.variables.some((v) => v.name === "topic")).toBe(true);
  });

  it("rejects when the label references an undeclared variable and addVariables is empty", async () => {
    // Defense-in-depth: without the inline declaration the integrity
    // check should still surface the bad reference.
    const { promptId, seedVersion, addNode } = await setup();
    await expect(
      addNode.execute({
        promptId,
        version: seedVersion,
        organizationId,
        label: "Process {{topic}}",
        kind: "step",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("RemoveBraidNodeUseCase", () => {
  it("forks with the node and its incident edges removed", async () => {
    const { promptId, seedVersion, removeNode, versions } = await setup();
    const result = await removeNode.execute({
      promptId,
      version: seedVersion,
      organizationId,
      nodeId: "Fix",
    });

    const forked = await versions.findByPromptAndLabelInOrganization(
      promptId,
      result.newVersion,
      organizationId,
    );
    expect(forked?.braidGraph?.nodes.some((n) => n.id === "Fix")).toBe(false);
    expect(
      forked?.braidGraph?.edges.some((e) => e.from === "Fix" || e.to === "Fix"),
    ).toBe(false);
  });
});

describe("AddBraidEdgeUseCase / RemoveBraidEdgeUseCase / RelabelBraidEdgeUseCase", () => {
  it("adds an edge between existing nodes", async () => {
    const { promptId, seedVersion, addEdge, versions } = await setup();
    const result = await addEdge.execute({
      promptId,
      version: seedVersion,
      organizationId,
      fromNodeId: "Start",
      toNodeId: "Check",
      label: "shortcut",
    });

    const forked = await versions.findByPromptAndLabelInOrganization(
      promptId,
      result.newVersion,
      organizationId,
    );
    expect(
      forked?.braidGraph?.edges.some(
        (e) => e.from === "Start" && e.to === "Check" && e.label === "shortcut",
      ),
    ).toBe(true);
  });

  it("rejects an add-edge command referencing a missing node", async () => {
    const { promptId, seedVersion, addEdge } = await setup();
    await expect(
      addEdge.execute({
        promptId,
        version: seedVersion,
        organizationId,
        fromNodeId: "Start",
        toNodeId: "Z",
        label: null,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("removes an edge by exact (from,to,label) match", async () => {
    const { promptId, seedVersion, removeEdge, versions } = await setup();
    const result = await removeEdge.execute({
      promptId,
      version: seedVersion,
      organizationId,
      fromNodeId: "Check",
      toNodeId: "Fix",
      label: "fail",
    });

    const forked = await versions.findByPromptAndLabelInOrganization(
      promptId,
      result.newVersion,
      organizationId,
    );
    expect(
      forked?.braidGraph?.edges.some(
        (e) => e.from === "Check" && e.to === "Fix" && e.label === "fail",
      ),
    ).toBe(false);
  });

  it("relabels an edge in place", async () => {
    const { promptId, seedVersion, relabelEdge, versions } = await setup();
    const result = await relabelEdge.execute({
      promptId,
      version: seedVersion,
      organizationId,
      fromNodeId: "Check",
      toNodeId: "Fix",
      oldLabel: "fail",
      newLabel: "rejected",
    });

    const forked = await versions.findByPromptAndLabelInOrganization(
      promptId,
      result.newVersion,
      organizationId,
    );
    expect(
      forked?.braidGraph?.edges.find((e) => e.from === "Check" && e.to === "Fix")
        ?.label,
    ).toBe("rejected");
  });
});

describe("Cross-cutting: structural edits require a graph", () => {
  it("rejects edits on a version that has no BRAID graph yet", async () => {
    // Setup fresh — v1 has no graph yet.
    const prompts = new InMemoryPromptAggregateRepository();
    const versions = new InMemoryPromptVersionRepository();
    const ids = new InMemoryIdGenerator();
    const uow = new NoOpUnitOfWork();
    const linter = createDefaultGraphLinter();
    const createPrompt = new CreatePromptUseCase(prompts, versions, ids, uow);
    const { prompt } = await createPrompt.execute({
      organizationId,
      userId,
      name: "Empty",
      description: "",
      taskType: "general",
      initialPrompt: "x",
    });

    const rename = new RenameBraidNodeUseCase({
      prompts, versions, linter, idGenerator: ids, uow,
    });
    await expect(
      rename.execute({
        promptId: prompt.id,
        version: "v1",
        organizationId,
        nodeId: "A",
        newLabel: "x",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
