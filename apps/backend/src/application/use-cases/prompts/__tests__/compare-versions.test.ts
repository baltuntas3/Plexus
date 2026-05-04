import { CompareVersionsUseCase } from "../compare-versions.js";
import { CreatePromptUseCase } from "../create-prompt.js";
import { CreateVersionUseCase } from "../create-version.js";
import { InMemoryIdGenerator } from "../../../../__tests__/fakes/in-memory-id-generator.js";
import { InMemoryPromptAggregateRepository } from "../../../../__tests__/fakes/in-memory-prompt-aggregate-repository.js";
import { InMemoryPromptVersionRepository } from "../../../../__tests__/fakes/in-memory-prompt-version-repository.js";
import { NoOpUnitOfWork } from "../../../../__tests__/fakes/no-op-unit-of-work.js";

const organizationId = "org-1";
const userId = "u-1";

const setup = async () => {
  const prompts = new InMemoryPromptAggregateRepository();
  const versions = new InMemoryPromptVersionRepository();
  const ids = new InMemoryIdGenerator();
  const uow = new NoOpUnitOfWork();
  const createPrompt = new CreatePromptUseCase(prompts, versions, ids, uow);
  const createVersion = new CreateVersionUseCase(prompts, versions, ids, uow);
  const compare = new CompareVersionsUseCase(prompts, versions);

  const { prompt } = await createPrompt.execute({
    organizationId,
    userId,
    name: "Summarizer",
    description: "",
    taskType: "general",
    initialPrompt: "Summarize the input.",
    variables: [
      { name: "topic", required: true },
      { name: "length", defaultValue: "short", required: false },
    ],
  });

  await createVersion.execute({
    promptId: prompt.id,
    organizationId,
    sourcePrompt: "Summarize the input concisely.",
    variables: [
      // topic kept as-is (unchanged)
      { name: "topic", required: true },
      // length: defaultValue changed (changed)
      { name: "length", defaultValue: "long", required: false },
      // tone: new variable (added)
      { name: "tone", description: "formal/casual", required: false },
    ],
  });

  return { compare, promptId: prompt.id };
};

describe("CompareVersionsUseCase", () => {
  it("returns both versions and a variables diff partitioned by name", async () => {
    const { compare, promptId } = await setup();
    const result = await compare.execute({
      promptId,
      organizationId,
      baseVersion: "v1",
      targetVersion: "v2",
    });

    expect(result.base.version).toBe("v1");
    expect(result.target.version).toBe("v2");
    expect(result.base.sourcePrompt).toBe("Summarize the input.");
    expect(result.target.sourcePrompt).toBe("Summarize the input concisely.");

    expect(result.variablesDiff.added.map((v) => v.name)).toEqual(["tone"]);
    expect(result.variablesDiff.changed.map((v) => v.name)).toEqual(["length"]);
    expect(result.variablesDiff.unchanged.map((v) => v.name)).toEqual(["topic"]);
    expect(result.variablesDiff.removed).toEqual([]);
  });

  it("rejects self-comparison", async () => {
    const { compare, promptId } = await setup();
    await expect(
      compare.execute({
        promptId,
        organizationId,
        baseVersion: "v1",
        targetVersion: "v1",
      }),
    ).rejects.toThrow(/itself/);
  });

  it("collapses cross-org promptId to PROMPT_NOT_FOUND", async () => {
    const { compare, promptId } = await setup();
    await expect(
      compare.execute({
        promptId,
        organizationId: "other-org",
        baseVersion: "v1",
        targetVersion: "v2",
      }),
    ).rejects.toMatchObject({ code: "PROMPT_NOT_FOUND" });
  });

  it("surfaces a typed not-found for missing version labels", async () => {
    const { compare, promptId } = await setup();
    await expect(
      compare.execute({
        promptId,
        organizationId,
        baseVersion: "v1",
        targetVersion: "v99",
      }),
    ).rejects.toMatchObject({ code: "PROMPT_VERSION_NOT_FOUND" });
  });
});
