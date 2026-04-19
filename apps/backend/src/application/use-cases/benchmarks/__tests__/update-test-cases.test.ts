import { UpdateTestCasesUseCase } from "../update-test-cases.js";
import { InMemoryBenchmarkRepository } from "../../../../__tests__/fakes/in-memory-benchmark-repository.js";

const buildDraftBenchmark = async (benchmarks: InMemoryBenchmarkRepository) =>
  benchmarks.create({
    name: "bm",
    ownerId: "u1",
    promptVersionIds: ["v1"],
    solverModels: ["gpt-4o-mini"],
    judgeModels: ["gpt-4o-mini"],
    generatorModel: "gpt-4o-mini",
    testGenerationMode: "shared-core",
    analysisModel: null,
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
  });

describe("UpdateTestCasesUseCase", () => {
  it("persists expected output annotations on a draft benchmark", async () => {
    const benchmarks = new InMemoryBenchmarkRepository();
    const useCase = new UpdateTestCasesUseCase(benchmarks);
    const bm = await buildDraftBenchmark(benchmarks);

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
    const benchmarks = new InMemoryBenchmarkRepository();
    const useCase = new UpdateTestCasesUseCase(benchmarks);
    const bm = await buildDraftBenchmark(benchmarks);

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

  it("rejects updates when the benchmark is not in draft status", async () => {
    const benchmarks = new InMemoryBenchmarkRepository();
    const useCase = new UpdateTestCasesUseCase(benchmarks);
    const bm = await buildDraftBenchmark(benchmarks);
    await benchmarks.updateStatus(bm.id, { status: "queued" });

    await expect(
      useCase.execute({ benchmarkId: bm.id, ownerId: "u1", updates: [], additions: [] }),
    ).rejects.toThrow(/draft/);
  });

  it("rejects access from a different owner", async () => {
    const benchmarks = new InMemoryBenchmarkRepository();
    const useCase = new UpdateTestCasesUseCase(benchmarks);
    const bm = await buildDraftBenchmark(benchmarks);

    await expect(
      useCase.execute({ benchmarkId: bm.id, ownerId: "other", updates: [], additions: [] }),
    ).rejects.toThrow(/don't own/);
  });
});
