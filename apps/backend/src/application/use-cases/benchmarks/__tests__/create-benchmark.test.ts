import { CreateBenchmarkUseCase } from "../create-benchmark.js";
import { InMemoryBenchmarkRepository } from "../../../../__tests__/fakes/in-memory-benchmark-repository.js";
import { InMemoryPromptAggregateRepository } from "../../../../__tests__/fakes/in-memory-prompt-aggregate-repository.js";
import { InMemoryPromptQueryService } from "../../../../__tests__/fakes/in-memory-prompt-query-service.js";
import { BraidGraph } from "../../../../domain/value-objects/braid-graph.js";
import type { GenerateRequest, IAIProvider, IAIProviderFactory } from "../../../services/ai-provider.js";

const CATEGORY_CYCLE = [
  "typical",
  "complex",
  "ambiguous",
  "adversarial",
  "edge_case",
  "contradictory",
  "stress",
] as const;

const makeProviders = (
  count = 5,
  capture?: (req: GenerateRequest) => void,
): IAIProviderFactory => {
  const cases = Array.from({ length: count }, (_, i) => ({
    input: `question ${i + 1}?`,
    category: CATEGORY_CYCLE[i % CATEGORY_CYCLE.length],
  }));
  const provider: IAIProvider = {
    generate: async (req: GenerateRequest) => {
      capture?.(req);
      return {
        text: JSON.stringify({ testCases: cases }),
        usage: { inputTokens: 10, outputTokens: 20 },
        model: req.model,
      };
    },
  };
  return { forModel: () => provider };
};

const buildScaffold = async () => {
  const benchmarks = new InMemoryBenchmarkRepository();
  const queries = new InMemoryPromptQueryService();
  const prompts = new InMemoryPromptAggregateRepository(queries);

  const promptId = await prompts.nextPromptId();
  const versionId = await prompts.nextVersionId();
  const { Prompt } = await import("../../../../domain/entities/prompt.js");
  const prompt = Prompt.create({
    id: promptId,
    ownerId: "u1",
    name: "Prompt",
    description: "desc",
    taskType: "math",
    initialVersionId: versionId,
    initialPrompt: "Answer.",
  });
  await prompts.save(prompt);
  const version = prompt.getVersionOrThrow("v1");

  return {
    useCase: new CreateBenchmarkUseCase(benchmarks, queries, makeProviders()),
    benchmarks,
    queries,
    prompts,
    version,
  };
};

const baseCommand = (versionId: string) => ({
  name: "Test benchmark",
  promptVersionIds: [versionId],
  solverModels: ["openai/gpt-oss-20b"],
  testCount: 5,
  ownerId: "u1",
});

describe("CreateBenchmarkUseCase", () => {
  it("creates a draft benchmark with generated test cases and derived defaults", async () => {
    const { useCase, version } = await buildScaffold();
    const { benchmark: bm, versionLabels } = await useCase.execute(baseCommand(version.id));
    expect(bm.status).toBe("draft");
    expect(bm.progress).toEqual({ completed: 0, total: 0 });
    expect(bm.promptVersionIds).toEqual([version.id]);
    expect(bm.testGenerationMode).toBe("shared-core");
    expect(bm.judgeModels.length).toBeGreaterThanOrEqual(1);
    expect(bm.judgeModels).not.toContain("openai/gpt-oss-20b");
    expect(bm.solverModels).not.toContain(bm.generatorModel);
    expect(bm.analysisModel).toBe(bm.judgeModels[0] ?? null);
    expect(bm.taskType).toBe("math");
    expect(bm.costForecast?.estimatedTotalCostUsd ?? 0).toBeGreaterThan(0);
    expect(bm.repetitions).toBeGreaterThanOrEqual(1);
    expect(bm.concurrency).toBeGreaterThanOrEqual(1);
    expect(bm.budgetUsd).toBe(50);
    expect(bm.testCount).toBe(5);
    expect(bm.testCases).toHaveLength(5);
    expect(bm.testCases[0]).toMatchObject({ input: expect.any(String), expectedOutput: null });
    expect(versionLabels[version.id]).toBe(version.version);
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

  it("builds generation spec from the real evaluation prompt, including braid graphs", async () => {
    const benchmarks = new InMemoryBenchmarkRepository();
    const queries = new InMemoryPromptQueryService();
    const prompts = new InMemoryPromptAggregateRepository(queries);

    const { Prompt } = await import("../../../../domain/entities/prompt.js");
    const prompt = Prompt.create({
      id: await prompts.nextPromptId(),
      ownerId: "u1",
      name: "Prompt",
      description: "",
      taskType: "math",
      initialVersionId: await prompts.nextVersionId(),
      initialPrompt: "Classical instructions.",
    });
    prompt.createVersion({
      id: await prompts.nextVersionId(),
      sourcePrompt: "Outdated classical prompt.",
    });
    // sourceVersion v2 has no braid yet → aggregate forks a new v3 with the braid.
    const { version: braid } = prompt.attachGeneratedBraid({
      sourceVersion: "v2",
      graph: BraidGraph.parse("graph TD\nA[start] --> B[end]"),
      generatorModel: "openai/gpt-oss-120b",
      newVersionId: await prompts.nextVersionId(),
    });
    await prompts.save(prompt);
    const classical = prompt.getVersionOrThrow("v1");

    const seen: GenerateRequest[] = [];
    const useCase = new CreateBenchmarkUseCase(
      benchmarks,
      queries,
      makeProviders(5, (req) => seen.push(req)),
    );

    await useCase.execute({
      ...baseCommand(classical.id),
      promptVersionIds: [classical.id, braid.id],
    });

    expect(seen).toHaveLength(1);
    const promptText = String(seen[0]?.messages[0]?.content ?? "");
    expect(promptText).toContain("Classical instructions.");
    expect(promptText).toContain("graph TD");
    expect(promptText).not.toContain("Outdated classical prompt.");
  });

  it("rejects generator output when fewer test cases are returned than requested", async () => {
    const { benchmarks, queries, version } = await buildScaffold();
    const useCase = new CreateBenchmarkUseCase(benchmarks, queries, makeProviders(2));

    await expect(
      useCase.execute({ ...baseCommand(version.id), testCount: 5 }),
    ).rejects.toThrow(/expected 5/);
  });

  it("defaults multi-version benchmarks to hybrid generation mode", async () => {
    const benchmarks = new InMemoryBenchmarkRepository();
    const queries = new InMemoryPromptQueryService();
    const prompts = new InMemoryPromptAggregateRepository(queries);

    const { Prompt } = await import("../../../../domain/entities/prompt.js");
    const prompt = Prompt.create({
      id: await prompts.nextPromptId(),
      ownerId: "u1",
      name: "Prompt",
      description: "",
      taskType: "math",
      initialVersionId: await prompts.nextVersionId(),
      initialPrompt: "Only answer in English.",
    });
    prompt.createVersion({
      id: await prompts.nextVersionId(),
      sourcePrompt: "Answer in Turkish when asked.",
    });
    await prompts.save(prompt);
    const v1 = prompt.getVersionOrThrow("v1");
    const v2 = prompt.getVersionOrThrow("v2");

    const seen: GenerateRequest[] = [];
    const useCase = new CreateBenchmarkUseCase(
      benchmarks,
      queries,
      makeProviders(5, (req) => seen.push(req)),
    );

    const { benchmark: bm } = await useCase.execute({
      ...baseCommand(v1.id),
      promptVersionIds: [v1.id, v2.id],
    });

    expect(bm.testGenerationMode).toBe("hybrid");
    const promptText = String(seen[0]?.messages[0]?.content ?? "");
    expect(promptText).toContain("balanced benchmark mix");
    expect(promptText).toContain("70% shared-core coverage and 30% diff-seeking coverage");
    expect(promptText).toContain("VERSION A");
    expect(promptText).toContain("VERSION B");
    expect(promptText).not.toContain("VERSION 1");
    expect(promptText).not.toContain("VERSION 2");
  });

  it("rejects benchmarks whose estimated cost exceeds the budget cap", async () => {
    const { benchmarks, queries, version } = await buildScaffold();
    const expensiveProvider: IAIProvider = {
      generate: async (req: GenerateRequest) => ({
        text: JSON.stringify({
          testCases: Array.from({ length: 50 }, (_, i) => ({
            input: `very long question ${i + 1} `.repeat(200),
            category: CATEGORY_CYCLE[i % CATEGORY_CYCLE.length],
          })),
        }),
        usage: { inputTokens: 10, outputTokens: 20 },
        model: req.model,
      }),
    };
    const useCase = new CreateBenchmarkUseCase(benchmarks, queries, {
      forModel: () => expensiveProvider,
    });

    await expect(
      useCase.execute({
        ...baseCommand(version.id),
        testCount: 50,
        solverModels: ["llama-3.3-70b-versatile", "openai/gpt-oss-20b"],
        repetitions: 10,
        budgetUsd: 1,
      }),
    ).rejects.toThrow(/exceeds the \$1\.00 cap/);
  });
});
