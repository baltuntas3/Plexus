import { CreateBenchmarkUseCase } from "../create-benchmark.js";
import { InMemoryBenchmarkRepository } from "../../../../__tests__/fakes/in-memory-benchmark-repository.js";
import { InMemoryPromptVersionRepository } from "../../../../__tests__/fakes/in-memory-prompt-version-repository.js";
import type { GenerateRequest, IAIProvider, IAIProviderFactory } from "../../../services/ai-provider.js";

// Stub provider returns valid test-case JSON for any generate call.
const makeProviders = (count = 5): IAIProviderFactory => {
  const cases = Array.from({ length: count }, (_, i) => `question ${i + 1}?`);
  const provider: IAIProvider = {
    generate: async (_req: GenerateRequest) => ({
      text: JSON.stringify({ testCases: cases }),
      usage: { inputTokens: 10, outputTokens: 20 },
      model: "gpt-4o-mini",
    }),
  };
  return { forModel: () => provider };
};

const buildScaffold = async () => {
  const benchmarks = new InMemoryBenchmarkRepository();
  const versions = new InMemoryPromptVersionRepository();

  const version = await versions.create({
    promptId: "p1",
    version: "v1",
    classicalPrompt: "Answer.",
  });

  return {
    useCase: new CreateBenchmarkUseCase(benchmarks, versions, makeProviders()),
    benchmarks,
    versions,
    version,
  };
};

const baseCommand = (versionId: string) => ({
  name: "Test benchmark",
  promptVersionIds: [versionId],
  solverModels: ["gpt-4o-mini"],
  judgeModel: "gpt-4o-mini",
  generatorModel: "gpt-4o-mini",
  testCount: 5,
  concurrency: 2,
  ownerId: "u1",
});

describe("CreateBenchmarkUseCase", () => {
  it("creates a draft benchmark with generated test cases", async () => {
    const { useCase, version } = await buildScaffold();
    const bm = await useCase.execute(baseCommand(version.id));
    expect(bm.status).toBe("draft");
    expect(bm.progress).toEqual({ completed: 0, total: 0 });
    expect(bm.promptVersionIds).toEqual([version.id]);
    expect(bm.generatorModel).toBe("gpt-4o-mini");
    expect(bm.testCount).toBe(5);
    expect(bm.testCases).toHaveLength(5);
    expect(bm.testCases[0]).toMatchObject({ input: expect.any(String), expectedOutput: null });
  });

  it("rejects unknown prompt versions", async () => {
    const { useCase } = await buildScaffold();
    await expect(
      useCase.execute(baseCommand("missing")),
    ).rejects.toThrow(/PromptVersion missing not found/);
  });

  it("rejects unknown solver models", async () => {
    const { useCase, version } = await buildScaffold();
    await expect(
      useCase.execute({
        ...baseCommand(version.id),
        solverModels: ["not-a-real-model"],
      }),
    ).rejects.toThrow(/Unknown model/);
  });

  it("rejects unknown judge model", async () => {
    const { useCase, version } = await buildScaffold();
    await expect(
      useCase.execute({
        ...baseCommand(version.id),
        judgeModel: "not-a-real-model",
      }),
    ).rejects.toThrow(/Unknown model/);
  });

  it("rejects unknown generator model", async () => {
    const { useCase, version } = await buildScaffold();
    await expect(
      useCase.execute({
        ...baseCommand(version.id),
        generatorModel: "not-a-real-model",
      }),
    ).rejects.toThrow(/Unknown model/);
  });
});
