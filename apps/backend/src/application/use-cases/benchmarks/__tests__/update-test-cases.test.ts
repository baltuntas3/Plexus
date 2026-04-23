import { UpdateTestCasesUseCase } from "../update-test-cases.js";
import { InMemoryBenchmarkRepository } from "../../../../__tests__/fakes/in-memory-benchmark-repository.js";
import { InMemoryPromptAggregateRepository } from "../../../../__tests__/fakes/in-memory-prompt-aggregate-repository.js";
import { InMemoryPromptQueryService } from "../../../../__tests__/fakes/in-memory-prompt-query-service.js";

const buildDraftBenchmark = async (
  benchmarks: InMemoryBenchmarkRepository,
  prompts: InMemoryPromptAggregateRepository,
) => {
  const { Prompt } = await import("../../../../domain/entities/prompt.js");
  const prompt = Prompt.create({
    id: await prompts.nextPromptId(),
    ownerId: "u1",
    name: "Prompt",
    description: "",
    taskType: "general",
    initialVersionId: await prompts.nextVersionId(),
    initialPrompt: "Answer.",
  });
  await prompts.save(prompt);
  const version = prompt.getVersionOrThrow("v1");

  return benchmarks.create({
    name: "bm",
    ownerId: "u1",
    promptVersionIds: [version.id],
    solverModels: ["openai/gpt-oss-20b"],
    judgeModels: ["openai/gpt-oss-20b"],
    generatorModel: "openai/gpt-oss-20b",
    testGenerationMode: "shared-core",
    analysisModel: null,
    taskType: "general",
    costForecast: null,
    testCount: 2,
    repetitions: 1,
    solverTemperature: 0.7,
    seed: 42,
    testCases: [
      {
        id: "tc1",
        input: "q1?",
        expectedOutput: null,
        category: null,
        source: "generated" as const,
      },
      {
        id: "tc2",
        input: "q2?",
        expectedOutput: null,
        category: null,
        source: "generated" as const,
      },
    ],
    concurrency: 2,
    cellTimeoutMs: null,
    budgetUsd: null,
  });
};

const buildHarness = async () => {
  const benchmarks = new InMemoryBenchmarkRepository();
  const queries = new InMemoryPromptQueryService();
  const prompts = new InMemoryPromptAggregateRepository(queries);
  const useCase = new UpdateTestCasesUseCase(benchmarks, queries);
  const bm = await buildDraftBenchmark(benchmarks, prompts);
  return { benchmarks, queries, prompts, useCase, bm };
};

describe("UpdateTestCasesUseCase", () => {
  it("persists expected output annotations on a draft benchmark", async () => {
    const { benchmarks, useCase, bm } = await buildHarness();

    await useCase.execute({
      benchmarkId: bm.id,
      ownerId: "u1",
      updates: [
        { id: "tc1", expectedOutput: "answer one" },
        { id: "tc2", expectedOutput: null },
      ],
      additions: [],
    });

    const updated = await benchmarks.findById(bm.id);
    expect(updated?.testCases[0]?.expectedOutput).toBe("answer one");
    expect(updated?.testCases[1]?.expectedOutput).toBeNull();
  });

  it("persists manual categories for added test cases", async () => {
    const { benchmarks, useCase, bm } = await buildHarness();

    await useCase.execute({
      benchmarkId: bm.id,
      ownerId: "u1",
      updates: [],
      additions: [{ input: "manual?", expectedOutput: null, category: "adversarial" }],
    });

    const updated = await benchmarks.findById(bm.id);
    expect(updated?.testCases.at(-1)?.category).toBe("adversarial");
    expect(updated?.testCases.at(-1)?.source).toBe("manual");
  });

  it("refreshes the cost forecast after draft test cases change", async () => {
    const { benchmarks, useCase, bm } = await buildHarness();

    await useCase.execute({
      benchmarkId: bm.id,
      ownerId: "u1",
      updates: [{ id: "tc1", input: "q1? ".repeat(200), expectedOutput: null }],
      additions: [],
    });

    const updated = await benchmarks.findById(bm.id);
    expect(updated?.costForecast?.estimatedTotalCostUsd).toBeGreaterThan(0);
  });

  it("rejects updates when the benchmark is not in draft status", async () => {
    const { benchmarks, useCase, bm } = await buildHarness();
    await benchmarks.updateStatus(bm.id, { status: "queued" });

    await expect(
      useCase.execute({ benchmarkId: bm.id, ownerId: "u1", updates: [], additions: [] }),
    ).rejects.toThrow(/draft/);
  });

  it("rejects access from a different owner", async () => {
    const { useCase, bm } = await buildHarness();

    await expect(
      useCase.execute({ benchmarkId: bm.id, ownerId: "other", updates: [], additions: [] }),
    ).rejects.toThrow(/don't own/);
  });
});
