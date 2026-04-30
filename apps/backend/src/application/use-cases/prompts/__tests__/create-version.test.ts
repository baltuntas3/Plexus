import { CreatePromptUseCase } from "../create-prompt.js";
import { CreateVersionUseCase } from "../create-version.js";
import { InMemoryPromptAggregateRepository } from "../../../../__tests__/fakes/in-memory-prompt-aggregate-repository.js";
import { InMemoryPromptVersionRepository } from "../../../../__tests__/fakes/in-memory-prompt-version-repository.js";
import { InMemoryIdGenerator } from "../../../../__tests__/fakes/in-memory-id-generator.js";
import { NoOpUnitOfWork } from "../../../../__tests__/fakes/no-op-unit-of-work.js";

// createVersion forks when fromVersion is supplied, produces a root version
// otherwise. The use case resolves `fromVersion` label → version via the
// version repo scoped to this prompt — a phantom parent outside the prompt
// is rejected at the lookup boundary.

describe("CreateVersionUseCase", () => {
  let prompts: InMemoryPromptAggregateRepository;
  let versions: InMemoryPromptVersionRepository;
  let ids: InMemoryIdGenerator;
  let createPrompt: CreatePromptUseCase;
  let createVersion: CreateVersionUseCase;
  let promptId: string;
  const userId = "u1";
  const organizationId = "org-1";

  beforeEach(async () => {
    prompts = new InMemoryPromptAggregateRepository();
    versions = new InMemoryPromptVersionRepository();
    ids = new InMemoryIdGenerator();
    const uow = new NoOpUnitOfWork();
    createPrompt = new CreatePromptUseCase(prompts, versions, ids, uow);
    createVersion = new CreateVersionUseCase(prompts, versions, ids, uow);

    const { prompt } = await createPrompt.execute({
      organizationId,
      userId,
      name: "p",
      description: "",
      taskType: "general",
      initialPrompt: "Answer concisely.",
    });
    promptId = prompt.id;
  });

  it("creates a root version when no ancestor is supplied", async () => {
    const v2 = await createVersion.execute({
      promptId,
      organizationId,
      userId,
      sourcePrompt: "Answer in one sentence.",
    });
    expect(v2.version).toBe("v2");
    expect(v2.parentVersionId).toBeNull();
    expect(v2.braidGraph).toBeNull();
  });

  it("records parentVersionId when forking from an existing version", async () => {
    const v2 = await createVersion.execute({
      promptId,
      organizationId,
      userId,
      sourcePrompt: "Answer in one sentence.",
      fromVersion: "v1",
    });
    const v1 = await versions.findByPromptAndLabelInOrganization(promptId, "v1", organizationId);
    expect(v2.parentVersionId).toBe(v1?.id);
    expect(v1?.sourcePrompt).toBe("Answer concisely.");
  });

  it("throws when the ancestor label does not belong to this prompt", async () => {
    await expect(
      createVersion.execute({
        promptId,
        organizationId,
      userId,
        sourcePrompt: "x",
        fromVersion: "v99",
      }),
    ).rejects.toMatchObject({ code: "PROMPT_VERSION_NOT_FOUND" });
  });
});
