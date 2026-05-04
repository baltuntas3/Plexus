import { CreatePromptUseCase } from "../create-prompt.js";
import { SaveBraidFromChatUseCase } from "../save-braid-from-chat.js";
import { createDefaultGraphLinter } from "../../../services/braid/lint/default-graph-linter.js";
import { InMemoryIdGenerator } from "../../../../__tests__/fakes/in-memory-id-generator.js";
import { InMemoryPromptAggregateRepository } from "../../../../__tests__/fakes/in-memory-prompt-aggregate-repository.js";
import { InMemoryPromptVersionRepository } from "../../../../__tests__/fakes/in-memory-prompt-version-repository.js";
import { NoOpUnitOfWork } from "../../../../__tests__/fakes/no-op-unit-of-work.js";

const organizationId = "org-1";
const userId = "u-1";
const generatorModel = "llama-3.3-70b-versatile";

const validMermaid = [
  "flowchart TD;",
  "  Start[Read input];",
  "  Plan[Plan steps];",
  "  Check[Verify result];",
  "  Fix[Revise on fail];",
  "  Start --> Plan;",
  "  Plan --> Check;",
  "  Check -- fail --> Fix;",
  "  Fix --> Check;",
].join("\n");

const setup = async () => {
  const prompts = new InMemoryPromptAggregateRepository();
  const versions = new InMemoryPromptVersionRepository();
  const ids = new InMemoryIdGenerator();
  const uow = new NoOpUnitOfWork();
  const linter = createDefaultGraphLinter();
  const createPrompt = new CreatePromptUseCase(prompts, versions, ids, uow);
  const save = new SaveBraidFromChatUseCase(prompts, versions, linter, ids, uow);

  const { prompt } = await createPrompt.execute({
    organizationId,
    userId,
    name: "Summarizer",
    description: "",
    taskType: "general",
    initialPrompt: "Summarize the input.",
  });
  return { promptId: prompt.id, save, prompts, versions };
};

describe("SaveBraidFromChatUseCase", () => {
  it("forks a new version with the supplied mermaid and records authorship", async () => {
    const { promptId, save, prompts, versions } = await setup();
    const result = await save.execute({
      promptId,
      version: "v1",
      organizationId,
      mermaidCode: validMermaid,
      generatorModel,
    });
    expect(result.newVersion).toBe("v2");
    expect(result.qualityScore.overall).toBeGreaterThan(0);

    const v2 = await versions.findByPromptAndLabelInOrganization(promptId, "v2", organizationId);
    expect(v2?.braidGraph?.mermaidCode).toContain("flowchart TD");
    expect(v2?.braidAuthorship?.toSnapshot()).toEqual({
      kind: "model",
      model: generatorModel,
    });
    // Production pointer untouched — saving from chat creates a draft.
    const prompt = await prompts.findInOrganization(promptId, organizationId);
    expect(prompt?.productionVersionId).toBeNull();
  });

  it("collapses cross-org promptId to PROMPT_NOT_FOUND", async () => {
    const { promptId, save } = await setup();
    await expect(
      save.execute({
        promptId,
        version: "v1",
        organizationId: "other-org",
        mermaidCode: validMermaid,
        generatorModel,
      }),
    ).rejects.toMatchObject({ code: "PROMPT_NOT_FOUND" });
  });

  it("rejects mermaid that introduces an undeclared template variable", async () => {
    // Variable integrity only fails on REFERENCES with no definition;
    // a definition without references is allowed (definitions may be
    // staged for a follow-up edit). To trigger a failure we save a
    // mermaid containing `{{newVar}}` that the source version did not
    // declare.
    const { promptId, save } = await setup();
    const mermaidWithUndeclared = validMermaid.replace(
      "Plan[Plan steps]",
      "Plan[Plan {{newVar}}]",
    );
    await expect(
      save.execute({
        promptId,
        version: "v1",
        organizationId,
        mermaidCode: mermaidWithUndeclared,
        generatorModel,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
