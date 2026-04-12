import { CreatePromptUseCase } from "../create-prompt.js";
import { CreateVersionUseCase } from "../create-version.js";
import { PromoteVersionUseCase } from "../promote-version.js";
import { InMemoryPromptRepository } from "../../../../__tests__/fakes/in-memory-prompt-repository.js";
import { InMemoryPromptVersionRepository } from "../../../../__tests__/fakes/in-memory-prompt-version-repository.js";

describe("PromoteVersionUseCase", () => {
  let prompts: InMemoryPromptRepository;
  let versions: InMemoryPromptVersionRepository;
  let createPrompt: CreatePromptUseCase;
  let createVersion: CreateVersionUseCase;
  let promoteVersion: PromoteVersionUseCase;
  let promptId: string;
  const ownerId = "user-1";

  beforeEach(async () => {
    prompts = new InMemoryPromptRepository();
    versions = new InMemoryPromptVersionRepository();
    createPrompt = new CreatePromptUseCase(prompts, versions);
    createVersion = new CreateVersionUseCase(prompts, versions);
    promoteVersion = new PromoteVersionUseCase(prompts, versions);

    const { prompt } = await createPrompt.execute({
      ownerId,
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
      ownerId,
      targetStatus: "staging",
    });
    expect(updated.status).toBe("staging");
  });

  it("sets prompt.productionVersion when promoting to production", async () => {
    await promoteVersion.execute({
      promptId,
      version: "v1",
      ownerId,
      targetStatus: "production",
    });
    const prompt = await prompts.findById(promptId);
    expect(prompt?.productionVersion).toBe("v1");
  });

  it("demotes previous production to staging when a new version is promoted", async () => {
    await promoteVersion.execute({
      promptId,
      version: "v1",
      ownerId,
      targetStatus: "production",
    });

    await createVersion.execute({
      promptId,
      ownerId,
      classicalPrompt: "Updated prompt",
    });
    await promoteVersion.execute({
      promptId,
      version: "v2",
      ownerId,
      targetStatus: "production",
    });

    const v1 = await versions.findByPromptAndVersion(promptId, "v1");
    const v2 = await versions.findByPromptAndVersion(promptId, "v2");
    const prompt = await prompts.findById(promptId);

    expect(v1?.status).toBe("staging");
    expect(v2?.status).toBe("production");
    expect(prompt?.productionVersion).toBe("v2");
  });

  it("forbids access to other users' prompts", async () => {
    await expect(
      promoteVersion.execute({
        promptId,
        version: "v1",
        ownerId: "other-user",
        targetStatus: "staging",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws NotFoundError for missing version", async () => {
    await expect(
      promoteVersion.execute({
        promptId,
        version: "v99",
        ownerId,
        targetStatus: "staging",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
