import { CreatePromptUseCase } from "../create-prompt.js";
import { CreateVersionUseCase } from "../create-version.js";
import { PromoteVersionUseCase } from "../promote-version.js";
import { InMemoryPromptAggregateRepository } from "../../../../__tests__/fakes/in-memory-prompt-aggregate-repository.js";
import { InMemoryPromptVersionRepository } from "../../../../__tests__/fakes/in-memory-prompt-version-repository.js";
import { InMemoryIdGenerator } from "../../../../__tests__/fakes/in-memory-id-generator.js";
import { NoOpUnitOfWork } from "../../../../__tests__/fakes/no-op-unit-of-work.js";

describe("PromoteVersionUseCase", () => {
  let prompts: InMemoryPromptAggregateRepository;
  let versions: InMemoryPromptVersionRepository;
  let createPrompt: CreatePromptUseCase;
  let createVersion: CreateVersionUseCase;
  let promoteVersion: PromoteVersionUseCase;
  let promptId: string;
  const userId = "user-1";
  const organizationId = "org-1";

  beforeEach(async () => {
    prompts = new InMemoryPromptAggregateRepository();
    versions = new InMemoryPromptVersionRepository();
    const ids = new InMemoryIdGenerator();
    const uow = new NoOpUnitOfWork();
    createPrompt = new CreatePromptUseCase(prompts, versions, ids, uow);
    createVersion = new CreateVersionUseCase(prompts, versions, ids, uow);
    promoteVersion = new PromoteVersionUseCase(prompts, versions, uow);

    const { prompt } = await createPrompt.execute({
      organizationId,
      userId,
      name: "Summarizer",
      description: "",
      taskType: "general",
      initialPrompt: "Summarize the following:",
    });
    promptId = prompt.id;
  });

  it("promotes a draft to staging", async () => {
    const updated = await promoteVersion.execute({
      promptId,
      version: "v1",
      organizationId,
      userId,
      targetStatus: "staging",
    });
    expect(updated.status).toBe("staging");
  });

  it("sets prompt.productionVersionId when promoting to production", async () => {
    await promoteVersion.execute({
      promptId,
      version: "v1",
      organizationId,
      userId,
      targetStatus: "production",
    });
    const prompt = await prompts.findById(promptId);
    const v1 = await versions.findByPromptAndLabel(promptId, "v1");
    expect(prompt?.productionVersionId).toBe(v1?.id);
  });

  it("demotes previous production to staging when a new version is promoted", async () => {
    await promoteVersion.execute({
      promptId,
      version: "v1",
      organizationId,
      userId,
      targetStatus: "production",
    });

    await createVersion.execute({
      promptId,
      organizationId,
      userId,
      sourcePrompt: "Updated prompt",
    });
    await promoteVersion.execute({
      promptId,
      version: "v2",
      organizationId,
      userId,
      targetStatus: "production",
    });

    const prompt = await prompts.findById(promptId);
    const v1 = await versions.findByPromptAndLabel(promptId, "v1");
    const v2 = await versions.findByPromptAndLabel(promptId, "v2");

    expect(v1?.status).toBe("staging");
    expect(v2?.status).toBe("production");
    expect(prompt?.productionVersionId).toBe(v2?.id);
  });

  it("hides other organizations' prompts behind a not-found response (no existence leak)", async () => {
    await expect(
      promoteVersion.execute({
        promptId,
        version: "v1",
        organizationId: "other-org",
        userId: "other-user",
        targetStatus: "staging",
      }),
    ).rejects.toMatchObject({ code: "PROMPT_NOT_FOUND" });
  });

  it("throws PromptVersionNotFoundError for missing version", async () => {
    await expect(
      promoteVersion.execute({
        promptId,
        version: "v99",
        organizationId,
      userId,
        targetStatus: "staging",
      }),
    ).rejects.toMatchObject({ code: "PROMPT_VERSION_NOT_FOUND" });
  });

  it("surfaces a typed transition error when demoting back to draft", async () => {
    await promoteVersion.execute({
      promptId,
      version: "v1",
      organizationId,
      userId,
      targetStatus: "staging",
    });
    await expect(
      promoteVersion.execute({
        promptId,
        version: "v1",
        organizationId,
      userId,
        targetStatus: "draft",
      }),
    ).rejects.toMatchObject({
      code: "PROMPT_INVALID_VERSION_TRANSITION",
      details: { from: "staging", to: "draft" },
    });
  });
});
