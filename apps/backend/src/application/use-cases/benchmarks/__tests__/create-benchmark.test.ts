import { CreateBenchmarkUseCase } from "../create-benchmark.js";
import { InMemoryBenchmarkRepository } from "../../../../__tests__/fakes/in-memory-benchmark-repository.js";
import { InMemoryPromptRepository } from "../../../../__tests__/fakes/in-memory-prompt-repository.js";
import { InMemoryPromptVersionRepository } from "../../../../__tests__/fakes/in-memory-prompt-version-repository.js";
import type { GenerateRequest, IAIProvider, IAIProviderFactory } from "../../../services/ai-provider.js";

// Mirror the round-robin category plan the generator enforces so the stub
// satisfies validateCategoryCoverage without hitting a real provider.
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
  const prompts = new InMemoryPromptRepository();
  const versions = new InMemoryPromptVersionRepository();
  const prompt = await prompts.create({
    name: "Prompt",
    description: "desc",
    taskType: "math",
    ownerId: "u1",
  });

  const version = await versions.create({
    promptId: prompt.id,
    version: "v1",
    classicalPrompt: "Answer.",
  });

  return {
    useCase: new CreateBenchmarkUseCase(benchmarks, versions, makeProviders(), prompts),
    benchmarks,
    prompts,
    versions,
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
    // Single version → shared-core; derived automatically.
    expect(bm.testGenerationMode).toBe("shared-core");
    // Judges derived: must exclude the solver itself and prefer models from
    // a different family. With only 3 models, same-family fallback is used.
    expect(bm.judgeModels.length).toBeGreaterThanOrEqual(1);
    expect(bm.judgeModels).not.toContain("openai/gpt-oss-20b");
    // Generator must not be in the solver set.
    expect(bm.solverModels).not.toContain(bm.generatorModel);
    // Analysis model defaults to the first judge.
    expect(bm.analysisModel).toBe(bm.judgeModels[0] ?? null);
    expect(bm.taskType).toBe("math");
    expect(bm.costForecast?.estimatedTotalCostUsd ?? 0).toBeGreaterThan(0);
    expect(bm.repetitions).toBeGreaterThanOrEqual(1);
    expect(bm.concurrency).toBeGreaterThanOrEqual(1);
    expect(bm.testCount).toBe(5);
    expect(bm.testCases).toHaveLength(5);
    expect(bm.testCases[0]).toMatchObject({ input: expect.any(String), expectedOutput: null });
    // Version labels fall back to the auto-generated "v1" when the version
    // has no user-set name yet.
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
    const versions = new InMemoryPromptVersionRepository();
    const classical = await versions.create({
      promptId: "p1",
      version: "v1",
      classicalPrompt: "Classical instructions.",
    });
    const braid = await versions.create({
      promptId: "p1",
      version: "v2",
      classicalPrompt: "Outdated classical prompt.",
    });
    await versions.setBraidGraph(braid.id, "graph TD\nA-->B", "openai/gpt-oss-120b");

    const seen: GenerateRequest[] = [];
    const useCase = new CreateBenchmarkUseCase(
      benchmarks,
      versions,
      makeProviders(5, (req) => seen.push(req)),
    );

    await useCase.execute({
      ...baseCommand(classical.id),
      promptVersionIds: [classical.id, braid.id],
    });

    expect(seen).toHaveLength(1);
    const prompt = String(seen[0]?.messages[0]?.content ?? "");
    expect(prompt).toContain("Classical instructions.");
    expect(prompt).toContain("graph TD");
    expect(prompt).not.toContain("Outdated classical prompt.");
  });

  it("rejects generator output when fewer test cases are returned than requested", async () => {
    const benchmarks = new InMemoryBenchmarkRepository();
    const versions = new InMemoryPromptVersionRepository();
    const version = await versions.create({
      promptId: "p1",
      version: "v1",
      classicalPrompt: "Answer.",
    });
    const useCase = new CreateBenchmarkUseCase(benchmarks, versions, makeProviders(2));

    await expect(
      useCase.execute({ ...baseCommand(version.id), testCount: 5 }),
    ).rejects.toThrow(/expected 5/);
  });

  it("defaults multi-version benchmarks to hybrid generation mode", async () => {
    const benchmarks = new InMemoryBenchmarkRepository();
    const versions = new InMemoryPromptVersionRepository();
    const v1 = await versions.create({
      promptId: "p1",
      version: "v1",
      classicalPrompt: "Only answer in English.",
    });
    const v2 = await versions.create({
      promptId: "p1",
      version: "v2",
      classicalPrompt: "Answer in Turkish when asked.",
    });

    const seen: GenerateRequest[] = [];
    const useCase = new CreateBenchmarkUseCase(
      benchmarks,
      versions,
      makeProviders(5, (req) => seen.push(req)),
    );

    const { benchmark: bm } = await useCase.execute({
      ...baseCommand(v1.id),
      promptVersionIds: [v1.id, v2.id],
    });

    expect(bm.testGenerationMode).toBe("hybrid");
    const prompt = String(seen[0]?.messages[0]?.content ?? "");
    expect(prompt).toContain("balanced benchmark mix");
    expect(prompt).toContain("70% shared-core coverage and 30% diff-seeking coverage");
    // Anonymous version labels — no chronological hints leak to the generator.
    expect(prompt).toContain("VERSION A");
    expect(prompt).toContain("VERSION B");
    expect(prompt).not.toContain("VERSION 1");
    expect(prompt).not.toContain("VERSION 2");
  });
});
