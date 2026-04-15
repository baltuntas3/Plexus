import type { Benchmark } from "../../../../domain/entities/benchmark.js";
import type {
  GenerateRequest,
  IAIProvider,
  IAIProviderFactory,
} from "../../ai-provider.js";
import type { IJudge, JudgeResult } from "../../judge/judge.js";
import type { JobContext } from "../../job-queue.js";
import { JudgeScore } from "../../../../domain/value-objects/judge-score.js";
import { InMemoryBenchmarkRepository } from "../../../../__tests__/fakes/in-memory-benchmark-repository.js";
import { InMemoryBenchmarkResultRepository } from "../../../../__tests__/fakes/in-memory-benchmark-result-repository.js";
import { InMemoryPromptVersionRepository } from "../../../../__tests__/fakes/in-memory-prompt-version-repository.js";
import { BenchmarkRunner } from "../benchmark-runner.js";

class RecordingProvider implements IAIProvider {
  public calls: GenerateRequest[] = [];
  constructor(
    private readonly respond: (req: GenerateRequest) => {
      text: string;
      inputTokens: number;
      outputTokens: number;
    },
  ) {}
  async generate(req: GenerateRequest) {
    this.calls.push(req);
    const r = this.respond(req);
    return {
      text: r.text,
      usage: { inputTokens: r.inputTokens, outputTokens: r.outputTokens },
      model: req.model,
    };
  }
}

class SingleProviderFactory implements IAIProviderFactory {
  constructor(private readonly provider: IAIProvider) {}
  forModel(): IAIProvider {
    return this.provider;
  }
}

class StubJudge implements IJudge {
  public calls = 0;
  constructor(
    private readonly score: { accuracy: number; coherence: number; instruction: number },
    private readonly judgeModel = "gpt-4o-mini",
  ) {}
  async grade(): Promise<JudgeResult> {
    this.calls += 1;
    return {
      score: JudgeScore.fromRubric(this.score, 0, "stub reasoning"),
      usage: { inputTokens: 20, outputTokens: 10 },
      model: this.judgeModel,
    };
  }
}

const buildContext = (): {
  ctx: JobContext;
  events: Array<{ completed: number; total: number }>;
} => {
  const events: Array<{ completed: number; total: number }> = [];
  const ctx: JobContext = {
    jobId: "job-1",
    reportProgress: async (update) => {
      const u = update as { completed: number; total: number };
      events.push({ completed: u.completed, total: u.total });
    },
  };
  return { ctx, events };
};

const TEST_CASES = [
  { id: "tc1", input: "q1?", expectedOutput: null },
  { id: "tc2", input: "q2?", expectedOutput: "expected answer" },
];

const buildScaffold = async () => {
  const benchmarks = new InMemoryBenchmarkRepository();
  const results = new InMemoryBenchmarkResultRepository();
  const versions = new InMemoryPromptVersionRepository();

  const version = await versions.create({
    promptId: "p1",
    version: "v1",
    classicalPrompt: "Answer concisely.",
  });

  return { benchmarks, results, versions, version };
};

const queueBenchmark = async (
  benchmarks: InMemoryBenchmarkRepository,
  overrides: Partial<Omit<Benchmark, "id" | "status" | "progress" | "jobId" | "error" | "createdAt" | "startedAt" | "completedAt">> = {},
  versionId = "1",
): Promise<Benchmark> =>
  benchmarks.create({
    name: "bm",
    ownerId: "u1",
    promptVersionIds: [versionId],
    solverModels: ["gpt-4o-mini"],
    judgeModel: "gpt-4o-mini",
    generatorModel: "gpt-4o-mini",
    testCount: 2,
    testCases: TEST_CASES,
    concurrency: 2,
    ...overrides,
  });

describe("BenchmarkRunner.run", () => {
  it("executes the full matrix, records results, and marks the benchmark completed", async () => {
    const { benchmarks, results, versions } = await buildScaffold();
    const provider = new RecordingProvider(() => ({
      text: "answer",
      inputTokens: 100,
      outputTokens: 50,
    }));
    const judge = new StubJudge({ accuracy: 5, coherence: 4, instruction: 4 });
    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      versions,
      providers: new SingleProviderFactory(provider),
      judgeFactory: () => judge,
    });

    const bm = await queueBenchmark(benchmarks);
    const { ctx, events } = buildContext();
    await runner.run(bm.id, ctx);

    expect(provider.calls).toHaveLength(2);
    expect(judge.calls).toBe(2);

    const rows = await results.listByBenchmark(bm.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "completed")).toBe(true);
    expect(rows.every((r) => r.finalScore > 0)).toBe(true);

    const final = await benchmarks.findById(bm.id);
    expect(final?.status).toBe("completed");
    expect(final?.progress).toEqual({ completed: 2, total: 2 });
    expect(final?.jobId).toBe("job-1");
    expect(final?.completedAt).not.toBeNull();

    expect(events.at(-1)).toEqual({ completed: 2, total: 2 });
  });

  it("passes expected output as reference to the judge when present", async () => {
    const { benchmarks, results, versions } = await buildScaffold();
    const gradeCalls: { reference?: string }[] = [];
    const judge: IJudge = {
      grade: async (input) => {
        gradeCalls.push({ reference: input.reference });
        return {
          score: JudgeScore.fromRubric({ accuracy: 5, coherence: 5, instruction: 5 }, 0, "ok"),
          usage: { inputTokens: 10, outputTokens: 5 },
          model: "gpt-4o-mini",
        };
      },
    };
    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      versions,
      providers: new SingleProviderFactory(
        new RecordingProvider(() => ({ text: "ans", inputTokens: 5, outputTokens: 5 })),
      ),
      judgeFactory: () => judge,
    });

    const bm = await queueBenchmark(benchmarks);
    await runner.run(bm.id, buildContext().ctx);

    // tc1 has no expected output → reference undefined
    // tc2 has expected output → reference passed
    const refs = gradeCalls.map((c) => c.reference);
    expect(refs).toContain(undefined);
    expect(refs).toContain("expected answer");
  });

  it("is restart-idempotent: a second run skips already-completed cells", async () => {
    const { benchmarks, results, versions } = await buildScaffold();
    const provider = new RecordingProvider(() => ({
      text: "answer",
      inputTokens: 10,
      outputTokens: 10,
    }));
    const judge = new StubJudge({ accuracy: 5, coherence: 5, instruction: 5 });
    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      versions,
      providers: new SingleProviderFactory(provider),
      judgeFactory: () => judge,
    });

    const bm = await queueBenchmark(benchmarks);
    await runner.run(bm.id, buildContext().ctx);
    expect(provider.calls).toHaveLength(2);

    await runner.run(bm.id, buildContext().ctx);
    expect(provider.calls).toHaveLength(2);
    expect(judge.calls).toBe(2);
    const rows = await results.listByBenchmark(bm.id);
    expect(rows).toHaveLength(2);
  });

  it("captures per-cell errors as failed rows without aborting the benchmark", async () => {
    const { benchmarks, results, versions } = await buildScaffold();

    let callIdx = 0;
    const provider = new RecordingProvider(() => {
      callIdx += 1;
      if (callIdx === 1) throw new Error("boom");
      return { text: "answer", inputTokens: 5, outputTokens: 5 };
    });
    const judge = new StubJudge({ accuracy: 4, coherence: 4, instruction: 4 });

    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      versions,
      providers: new SingleProviderFactory(provider),
      judgeFactory: () => judge,
    });

    const bm = await queueBenchmark(benchmarks, { concurrency: 1 });
    await runner.run(bm.id, buildContext().ctx);

    const rows = await results.listByBenchmark(bm.id);
    expect(rows).toHaveLength(2);
    const failed = rows.filter((r) => r.status === "failed");
    const passed = rows.filter((r) => r.status === "completed");
    expect(failed).toHaveLength(1);
    expect(passed).toHaveLength(1);
    expect(failed[0]?.error).toContain("boom");

    const final = await benchmarks.findById(bm.id);
    expect(final?.status).toBe("completed");
  });

  it("uses braidGraph as system prompt when the version has one, classicalPrompt otherwise", async () => {
    const { benchmarks, results, versions } = await buildScaffold();

    const versionWithBraid = await versions.create({
      promptId: "p1",
      version: "v2",
      classicalPrompt: "classical",
    });
    await versions.setBraidGraph(versionWithBraid.id, "graph TD\nA-->B", "gpt-4o");

    const provider = new RecordingProvider((req) => ({
      text: `seen:${req.messages[0]?.content?.slice(0, 8) ?? ""}`,
      inputTokens: 1,
      outputTokens: 1,
    }));
    const judge = new StubJudge({ accuracy: 3, coherence: 3, instruction: 3 });

    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      versions,
      providers: new SingleProviderFactory(provider),
      judgeFactory: () => judge,
    });

    const bm = await queueBenchmark(benchmarks, {
      testCases: [{ id: "tc1", input: "q1?", expectedOutput: null }],
      promptVersionIds: ["1", versionWithBraid.id],
    });

    await runner.run(bm.id, buildContext().ctx);

    const rows = await results.listByBenchmark(bm.id);
    // version 1 (no braid, classical) + version 2 (braid) = 2 cells
    expect(rows).toHaveLength(2);

    const braidCall = provider.calls.find((c) =>
      (c.messages[0]?.content ?? "").includes("BRAID"),
    );
    expect(braidCall).toBeDefined();

    const classicalCall = provider.calls.find((c) =>
      !(c.messages[0]?.content ?? "").includes("BRAID"),
    );
    expect(classicalCall).toBeDefined();
  });

  it("marks the benchmark failed when it has no test cases", async () => {
    const { benchmarks, results, versions } = await buildScaffold();
    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      versions,
      providers: new SingleProviderFactory(
        new RecordingProvider(() => ({ text: "x", inputTokens: 1, outputTokens: 1 })),
      ),
      judgeFactory: () => new StubJudge({ accuracy: 5, coherence: 5, instruction: 5 }),
    });

    const bm = await queueBenchmark(benchmarks, { testCases: [] });
    await expect(runner.run(bm.id, buildContext().ctx)).rejects.toThrow(/no test cases/);
    const final = await benchmarks.findById(bm.id);
    expect(final?.status).toBe("failed");
  });
});
