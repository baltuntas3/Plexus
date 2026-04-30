import { CreatePromptUseCase } from "../create-prompt.js";
import { ListPromptsUseCase } from "../list-prompts.js";
import { InMemoryPromptAggregateRepository } from "../../../../__tests__/fakes/in-memory-prompt-aggregate-repository.js";
import { InMemoryPromptVersionRepository } from "../../../../__tests__/fakes/in-memory-prompt-version-repository.js";
import { InMemoryPromptQueryService } from "../../../../__tests__/fakes/in-memory-prompt-query-service.js";
import { InMemoryIdGenerator } from "../../../../__tests__/fakes/in-memory-id-generator.js";
import { NoOpUnitOfWork } from "../../../../__tests__/fakes/no-op-unit-of-work.js";

const setup = () => {
  const queries = new InMemoryPromptQueryService();
  const prompts = new InMemoryPromptAggregateRepository(queries);
  const versions = new InMemoryPromptVersionRepository(queries);
  const ids = new InMemoryIdGenerator();
  const uow = new NoOpUnitOfWork();
  const create = new CreatePromptUseCase(prompts, versions, ids, uow);
  const list = new ListPromptsUseCase(queries);
  return { create, list };
};

describe("ListPromptsUseCase", () => {
  it("returns only prompts in the caller's organization", async () => {
    const { create, list } = setup();
    await create.execute({
      organizationId: "org-1",
      userId: "u",
      name: "ours",
      description: "",
      taskType: "general",
      initialPrompt: "hi",
    });
    await create.execute({
      organizationId: "org-2",
      userId: "u",
      name: "theirs",
      description: "",
      taskType: "general",
      initialPrompt: "hi",
    });
    const result = await list.execute({
      organizationId: "org-1",
      page: 1,
      pageSize: 20,
    });
    expect(result.total).toBe(1);
    expect(result.items[0]?.name).toBe("ours");
  });

  it("paginates", async () => {
    const { create, list } = setup();
    for (let i = 0; i < 5; i += 1) {
      await create.execute({
        organizationId: "org-1",
        userId: "u",
        name: `p${i}`,
        description: "",
        taskType: "general",
        initialPrompt: "hi",
      });
    }
    const page1 = await list.execute({ organizationId: "org-1", page: 1, pageSize: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(5);
    const page3 = await list.execute({ organizationId: "org-1", page: 3, pageSize: 2 });
    expect(page3.items).toHaveLength(1);
  });

  it("filters by case-insensitive name search", async () => {
    const { create, list } = setup();
    await create.execute({
      organizationId: "org-1",
      userId: "u",
      name: "Summarizer",
      description: "",
      taskType: "general",
      initialPrompt: "hi",
    });
    await create.execute({
      organizationId: "org-1",
      userId: "u",
      name: "Translator",
      description: "",
      taskType: "general",
      initialPrompt: "hi",
    });
    const result = await list.execute({
      organizationId: "org-1",
      page: 1,
      pageSize: 20,
      search: "summa",
    });
    expect(result.total).toBe(1);
    expect(result.items[0]?.name).toBe("Summarizer");
  });
});
