import { CreatePromptUseCase } from "../create-prompt.js";
import { InMemoryPromptAggregateRepository } from "../../../../__tests__/fakes/in-memory-prompt-aggregate-repository.js";
import { InMemoryPromptVersionRepository } from "../../../../__tests__/fakes/in-memory-prompt-version-repository.js";
import { InMemoryPromptQueryService } from "../../../../__tests__/fakes/in-memory-prompt-query-service.js";
import { InMemoryIdGenerator } from "../../../../__tests__/fakes/in-memory-id-generator.js";
import { NoOpUnitOfWork } from "../../../../__tests__/fakes/no-op-unit-of-work.js";

const baseCommand = {
  organizationId: "org-1",
  userId: "user-1",
  name: "Summarizer",
  description: "summarize text",
  taskType: "general" as const,
  initialPrompt: "Summarize: {{input}}",
};

const setup = () => {
  const queries = new InMemoryPromptQueryService();
  const prompts = new InMemoryPromptAggregateRepository(queries);
  const versions = new InMemoryPromptVersionRepository(queries);
  const ids = new InMemoryIdGenerator();
  const uow = new NoOpUnitOfWork();
  const useCase = new CreatePromptUseCase(prompts, versions, ids, uow);
  return { useCase, prompts, versions, queries };
};

describe("CreatePromptUseCase", () => {
  it("creates the prompt root and an initial v1 atomically", async () => {
    const { useCase, prompts, versions } = setup();
    const result = await useCase.execute({
      ...baseCommand,
      variables: [{ name: "input", required: false }],
    });
    expect(result.prompt.name).toBe("Summarizer");
    expect(result.prompt.organizationId).toBe(baseCommand.organizationId);
    expect(result.prompt.creatorId).toBe(baseCommand.userId);
    expect(result.version.version).toBe("v1");
    expect(result.version.parentVersionId).toBeNull();
    expect(result.version.status).toBe("draft");

    const stored = await prompts.findInOrganization(result.prompt.id, "org-1");
    expect(stored?.versionCounter).toBe(1);
    const storedVersion = await versions.findByPromptAndLabelInOrganization(
      result.prompt.id,
      "v1",
      "org-1",
    );
    expect(storedVersion?.organizationId).toBe("org-1");
    expect(storedVersion?.variables.map((v) => v.name)).toEqual(["input"]);
  });

  it("rejects undeclared {{var}} references in the initial prompt", async () => {
    const { useCase } = setup();
    await expect(
      useCase.execute({
        ...baseCommand,
        initialPrompt: "Refer to {{ghost}}",
        variables: [{ name: "input", required: false }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("allows declared variables that are unreferenced (warning, not error)", async () => {
    const { useCase } = setup();
    await expect(
      useCase.execute({
        ...baseCommand,
        initialPrompt: "no placeholders here",
        variables: [{ name: "unused", required: false }],
      }),
    ).resolves.toBeDefined();
  });

  it("does not require a variable list when the body has no placeholders", async () => {
    const { useCase } = setup();
    const result = await useCase.execute({
      ...baseCommand,
      initialPrompt: "Plain prompt",
    });
    expect(result.version.variables).toEqual([]);
  });
});
