import { UpdateTestCasesUseCase } from "../update-test-cases.js";
import { InMemoryBenchmarkRepository } from "../../../../__tests__/fakes/in-memory-benchmark-repository.js";
import { InMemoryPromptAggregateRepository } from "../../../../__tests__/fakes/in-memory-prompt-aggregate-repository.js";
import { InMemoryPromptVersionRepository } from "../../../../__tests__/fakes/in-memory-prompt-version-repository.js";
import { InMemoryPromptQueryService } from "../../../../__tests__/fakes/in-memory-prompt-query-service.js";
import { InMemoryIdGenerator } from "../../../../__tests__/fakes/in-memory-id-generator.js";
import { Benchmark } from "../../../../domain/entities/benchmark.js";
import { PromptVersion } from "../../../../domain/entities/prompt-version.js";

const buildDraftBenchmark = async (
  benchmarks: InMemoryBenchmarkRepository,
  prompts: InMemoryPromptAggregateRepository,
  versions: InMemoryPromptVersionRepository,
  ids: InMemoryIdGenerator,
): Promise<Benchmark> => {
  const { Prompt } = await import("../../../../domain/entities/prompt.js");
  const prompt = Prompt.create({
    promptId: ids.newId(),
    organizationId: "org-1",
    creatorId: "u1",
    name: "Prompt",
    description: "",
    taskType: "general",
  });
  const version = PromptVersion.create({
    id: ids.newId(),
    promptId: prompt.id,
      organizationId: prompt.organizationId,
    version: prompt.allocateNextVersionLabel(),
    sourcePrompt: "Answer.",
  });
  await prompts.save(prompt);
  await versions.save(version);

  const benchmark = Benchmark.create({
    id: ids.newId(),
    name: "bm",
    organizationId: "org-1",
    creatorId: "u1",
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
  await benchmarks.save(benchmark);
  return benchmark;
};

const buildHarness = async () => {
  const benchmarks = new InMemoryBenchmarkRepository();
  const queries = new InMemoryPromptQueryService();
  const prompts = new InMemoryPromptAggregateRepository(queries);
  const versions = new InMemoryPromptVersionRepository(queries);
  const ids = new InMemoryIdGenerator();
  const useCase = new UpdateTestCasesUseCase(benchmarks, queries, ids);
  const bm = await buildDraftBenchmark(benchmarks, prompts, versions, ids);
  return { benchmarks, queries, prompts, versions, useCase, bm };
};

describe("UpdateTestCasesUseCase", () => {
  it("persists expected output annotations on a draft benchmark", async () => {
    const { benchmarks, useCase, bm } = await buildHarness();

    await useCase.execute({
      benchmarkId: bm.id,
      organizationId: "org-1",
      userId: "u1",
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
      organizationId: "org-1",
      userId: "u1",
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
      organizationId: "org-1",
      userId: "u1",
      updates: [{ id: "tc1", input: "q1? ".repeat(200), expectedOutput: null }],
      additions: [],
    });

    const updated = await benchmarks.findById(bm.id);
    expect(updated?.costForecast?.estimatedTotalCostUsd).toBeGreaterThan(0);
  });

  it("rejects updates when the benchmark is not in draft status", async () => {
    const { benchmarks, useCase, bm } = await buildHarness();
    // Transition the aggregate out of draft via its own state machine so the
    // "can only edit while draft" invariant is exercised through real methods,
    // not a store hack.
    const loaded = await benchmarks.findById(bm.id);
    loaded!.queue();
    await benchmarks.save(loaded!);

    await expect(
      useCase.execute({
        benchmarkId: bm.id,
        organizationId: "org-1",
        userId: "u1",
        updates: [],
        additions: [],
      }),
    ).rejects.toMatchObject({ code: "BENCHMARK_NOT_IN_DRAFT" });
  });

  it("hides other organizations' benchmarks behind a not-found response (no existence leak)", async () => {
    const { useCase, bm } = await buildHarness();

    await expect(
      useCase.execute({
        benchmarkId: bm.id,
        organizationId: "other-org",
        userId: "other",
        updates: [],
        additions: [],
      }),
    ).rejects.toMatchObject({ code: "BENCHMARK_NOT_FOUND" });
  });
});
