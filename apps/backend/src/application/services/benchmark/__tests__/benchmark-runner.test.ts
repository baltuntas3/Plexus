import type { Benchmark } from "../../../../domain/entities/benchmark.js";
import type {
  GenerateRequest,
  IAIProvider,
  IAIProviderFactory,
} from "../../ai-provider.js";
import type { IJudge, JudgeResult } from "../../judge/judge.js";
import { JudgeExecutionError } from "../../judge/judge.js";
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
    private readonly judgeModel = "openai/gpt-oss-20b",
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
  { id: "tc1", input: "q1?", expectedOutput: null, category: null, source: "generated" as const },
  {
    id: "tc2",
    input: "q2?",
    expectedOutput: "expected answer",
    category: null,
    source: "generated" as const,
  },
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
  overrides: Partial<
    Omit<Benchmark, "id" | "status" | "progress" | "jobId" | "error" | "createdAt" | "startedAt" | "completedAt">
  > = {},
  versionId = "1",
): Promise<Benchmark> =>
  benchmarks.create({
    name: overrides.name ?? "bm",
    ownerId: overrides.ownerId ?? "u1",
    promptVersionIds: overrides.promptVersionIds ?? [versionId],
    solverModels: overrides.solverModels ?? ["openai/gpt-oss-20b"],
    judgeModels: overrides.judgeModels ?? ["openai/gpt-oss-20b"],
    generatorModel: overrides.generatorModel ?? "openai/gpt-oss-20b",
    testGenerationMode: overrides.testGenerationMode ?? "shared-core",
    analysisModel: overrides.analysisModel ?? null,
    taskType: overrides.taskType ?? "general",
    costForecast: overrides.costForecast ?? null,
    testCount: overrides.testCount ?? 2,
    repetitions: overrides.repetitions ?? 1,
    solverTemperature: overrides.solverTemperature ?? 0.7,
    seed: overrides.seed ?? 42,
    testCases: overrides.testCases ?? TEST_CASES,
    concurrency: overrides.concurrency ?? 2,
    cellTimeoutMs: overrides.cellTimeoutMs ?? null,
    budgetUsd: overrides.budgetUsd ?? null,
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
    expect(rows.every((r) => r.judgeFailureCount === 0)).toBe(true);

    const final = await benchmarks.findById(bm.id);
    expect(final?.status).toBe("completed");
    expect(final?.progress).toEqual({ completed: 2, total: 2 });
    expect(final?.jobId).toBe("job-1");
    expect(final?.completedAt).not.toBeNull();

    expect(events.at(-1)).toEqual({ completed: 2, total: 2 });
  });

  it("repeats each cell k times with distinct seeds so variance can be measured", async () => {
    const { benchmarks, results, versions } = await buildScaffold();
    const provider = new RecordingProvider(() => ({
      text: "answer",
      inputTokens: 1,
      outputTokens: 1,
    }));
    const judge = new StubJudge({ accuracy: 5, coherence: 5, instruction: 5 });
    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      versions,
      providers: new SingleProviderFactory(provider),
      judgeFactory: () => judge,
    });

    const bm = await queueBenchmark(benchmarks, { repetitions: 3, concurrency: 1 });
    await runner.run(bm.id, buildContext().ctx);

    const rows = await results.listByBenchmark(bm.id);
    // 2 testCases × 1 version × 1 solver × 3 reps = 6 rows
    expect(rows).toHaveLength(6);

    // runIndex values 0..2 must all appear per testCase/version/solver.
    const byCell = new Map<string, number[]>();
    for (const r of rows) {
      const k = `${r.testCaseId}::${r.promptVersionId}::${r.solverModel}`;
      byCell.set(k, [...(byCell.get(k) ?? []), r.runIndex]);
    }
    for (const indices of byCell.values()) {
      expect([...indices].sort()).toEqual([0, 1, 2]);
    }

    // Solver seeds are distinct across runs of the same cell.
    const seeds = new Set(provider.calls.map((c) => c.seed));
    expect(seeds.size).toBe(6);
  });

  it("passes deterministic judge seeds so reruns are reproducible", async () => {
    const { benchmarks, versions, results } = await buildScaffold();
    const solverProvider = new RecordingProvider(() => ({
      text: "answer",
      inputTokens: 1,
      outputTokens: 1,
    }));
    const judgeProvider = new RecordingProvider(() => ({
      text: JSON.stringify({
        accuracy: 5,
        coherence: 5,
        instruction: 5,
        reasoning: "ok",
      }),
      inputTokens: 2,
      outputTokens: 2,
    }));
    const providers: IAIProviderFactory = {
      forModel: (model) => (model === "judge-model" ? judgeProvider : solverProvider),
    };
    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      versions,
      providers,
    });

    const bm = await queueBenchmark(benchmarks, {
      judgeModels: ["judge-model"],
      repetitions: 2,
      concurrency: 1,
    });
    await runner.run(bm.id, buildContext().ctx);

    expect(judgeProvider.calls).toHaveLength(4);
    expect(new Set(judgeProvider.calls.map((call) => call.seed)).size).toBe(4);
    expect(judgeProvider.calls.every((call) => call.seed !== undefined)).toBe(true);
  });

  it("does not penalize long reference-free rows based on competitor outputs", async () => {
    const { benchmarks, results, versions } = await buildScaffold();
    const provider = new RecordingProvider((req) => {
      const text =
        req.messages[1]?.content === "q1?" && req.messages[0]?.content === "Answer concisely."
          ? "x ".repeat(300)
          : "short";
      return { text, inputTokens: 1, outputTokens: text.length };
    });
    const judge = new StubJudge({ accuracy: 5, coherence: 5, instruction: 5 });
    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      versions,
      providers: new SingleProviderFactory(provider),
      judgeFactory: () => judge,
    });

    const bm = await queueBenchmark(benchmarks, {
      testCases: [
        { id: "tc1", input: "q1?", expectedOutput: null, category: null, source: "generated" },
      ],
      promptVersionIds: [
        "1",
        (await versions.create({
          promptId: "p1",
          version: "v2",
          classicalPrompt: "Answer with more detail when useful.",
        })).id,
        (await versions.create({
          promptId: "p1",
          version: "v3",
          classicalPrompt: "Keep answers compact.",
        })).id,
      ],
      concurrency: 1,
    });

    await runner.run(bm.id, buildContext().ctx);
    const rows = await results.listByBenchmark(bm.id);
    expect(rows.every((row) => row.verbosityPenalty === 0)).toBe(true);
  });

  it("does not penalize short reference-free rows based on competitor outputs", async () => {
    const { benchmarks, results, versions } = await buildScaffold();
    const provider = new RecordingProvider((req) => {
      const prompt = String(req.messages[0]?.content ?? "");
      const text = prompt.includes("more detail") ? "detailed answer with enough context" : "ok";
      return { text, inputTokens: 1, outputTokens: text.length };
    });
    const judge = new StubJudge({ accuracy: 5, coherence: 5, instruction: 5 });
    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      versions,
      providers: new SingleProviderFactory(provider),
      judgeFactory: () => judge,
    });

    const bm = await queueBenchmark(benchmarks, {
      testCases: [
        { id: "tc1", input: "q1?", expectedOutput: null, category: null, source: "generated" },
      ],
      promptVersionIds: [
        "1",
        (await versions.create({
          promptId: "p1",
          version: "v2",
          classicalPrompt: "Answer with more detail when useful.",
        })).id,
      ],
      concurrency: 1,
    });

    await runner.run(bm.id, buildContext().ctx);
    const rows = await results.listByBenchmark(bm.id);
    expect(rows.every((row) => row.verbosityPenalty === 0)).toBe(true);
  });

  it("grades every row with every judge in the ensemble and averages their scores", async () => {
    const { benchmarks, results, versions } = await buildScaffold();
    const provider = new RecordingProvider(() => ({
      text: "answer",
      inputTokens: 1,
      outputTokens: 1,
    }));

    const judgeA = new StubJudge({ accuracy: 5, coherence: 5, instruction: 5 }, "openai/gpt-oss-20b");
    const judgeB = new StubJudge({ accuracy: 3, coherence: 3, instruction: 3 }, "openai/gpt-oss-120b");
    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      versions,
      providers: new SingleProviderFactory(provider),
      judgeFactory: (model) => (model === "openai/gpt-oss-20b" ? judgeA : judgeB),
    });

    const bm = await queueBenchmark(benchmarks, {
      judgeModels: ["openai/gpt-oss-20b", "openai/gpt-oss-120b"],
      testCases: [
        {
          id: "tc1",
          input: "q1?",
          expectedOutput: null,
          category: null,
          source: "generated" as const,
        },
      ],
    });
    await runner.run(bm.id, buildContext().ctx);

    expect(judgeA.calls).toBe(1);
    expect(judgeB.calls).toBe(1);

    const rows = await results.listByBenchmark(bm.id);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.judgeVotes).toHaveLength(2);
    expect(row.judgeAccuracy).toBeCloseTo(4, 6);
    expect(row.judgeCoherence).toBeCloseTo(4, 6);
    expect(row.judgeInstruction).toBeCloseTo(4, 6);
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
          model: "openai/gpt-oss-20b",
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

    const refs = gradeCalls.map((c) => c.reference);
    expect(refs).toContain(undefined);
    expect(refs).toContain("expected answer");
  });

  it("is restart-idempotent: a second run skips already-recorded rows", async () => {
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

  it("keeps a row completed when at least one judge succeeds", async () => {
    const { benchmarks, results, versions } = await buildScaffold();
    const provider = new RecordingProvider(() => ({
      text: "answer",
      inputTokens: 5,
      outputTokens: 5,
    }));

    let judgeCall = 0;
    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      versions,
      providers: new SingleProviderFactory(provider),
      judgeFactory: () => ({
        grade: async () => {
          judgeCall += 1;
          if (judgeCall === 2) {
            throw new JudgeExecutionError("judge parse failed", {
              usage: { inputTokens: 11, outputTokens: 7 },
              model: "openai/gpt-oss-120b",
            });
          }
          return {
            score: JudgeScore.fromRubric(
              { accuracy: 5, coherence: 4, instruction: 4 },
              0,
              "ok",
            ),
            usage: { inputTokens: 10, outputTokens: 6 },
            model: "openai/gpt-oss-20b",
          };
        },
      }),
    });

    const bm = await queueBenchmark(benchmarks, {
      judgeModels: ["openai/gpt-oss-20b", "openai/gpt-oss-120b"],
      testCases: [
        {
          id: "tc1",
          input: "q1?",
          expectedOutput: null,
          category: null,
          source: "generated" as const,
        },
      ],
      concurrency: 1,
    });

    await runner.run(bm.id, buildContext().ctx);
    const [onlyRow] = await results.listByBenchmark(bm.id);
    expect(onlyRow?.status).toBe("completed");
    expect(onlyRow?.judgeVotes).toHaveLength(1);
    expect(onlyRow?.judgeFailureCount).toBe(1);
    expect(onlyRow?.judgeCostUsd).toBeGreaterThan(0);
    expect(onlyRow?.error).toContain("Partial judge failure");
  });

  it("does not retry previously failed rows on resume", async () => {
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
    expect(provider.calls).toHaveLength(2);

    await runner.run(bm.id, buildContext().ctx);
    expect(provider.calls).toHaveLength(2);

    const rows = await results.listByBenchmark(bm.id);
    expect(rows.filter((row) => row.status === "failed")).toHaveLength(1);
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

  it("preserves observed latency and solver cost when a row fails after candidate generation", async () => {
    const { benchmarks, results, versions } = await buildScaffold();

    const provider = new RecordingProvider(() => ({
      text: "candidate answer",
      inputTokens: 12,
      outputTokens: 8,
    }));
    const judge: IJudge = {
      grade: async () => {
        throw new Error("judge exploded");
      },
    };

    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      versions,
      providers: new SingleProviderFactory(provider),
      judgeFactory: () => judge,
    });

    const bm = await queueBenchmark(benchmarks, {
      testCases: [
        {
          id: "tc1",
          input: "q1?",
          expectedOutput: null,
          category: null,
          source: "generated" as const,
        },
      ],
      concurrency: 1,
    });

    await runner.run(bm.id, buildContext().ctx);
    const [failed] = await results.listByBenchmark(bm.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.candidateOutput).toBe("candidate answer");
    expect(failed?.candidateInputTokens).toBe(12);
    expect(failed?.candidateOutputTokens).toBe(8);
    expect(failed?.candidateCostUsd).toBeGreaterThan(0);
    expect(failed?.totalCostUsd).toBe(failed?.candidateCostUsd);
    expect(failed?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(failed?.error).toContain("judge exploded");
  });

  it("preserves partial judge token usage and cost when judge parsing fails after generation", async () => {
    const { benchmarks, results, versions } = await buildScaffold();
    const provider = new RecordingProvider(() => ({
      text: "candidate answer",
      inputTokens: 10,
      outputTokens: 5,
    }));
    const judge: IJudge = {
      grade: async () => {
        throw new JudgeExecutionError("judge returned malformed JSON", {
          usage: { inputTokens: 30, outputTokens: 12 },
          model: "openai/gpt-oss-20b",
        });
      },
    };

    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      versions,
      providers: new SingleProviderFactory(provider),
      judgeFactory: () => judge,
    });

    const bm = await queueBenchmark(benchmarks, {
      testCases: [
        {
          id: "tc1",
          input: "q1?",
          expectedOutput: null,
          category: null,
          source: "generated" as const,
        },
      ],
      concurrency: 1,
    });

    await runner.run(bm.id, buildContext().ctx);
    const [failed] = await results.listByBenchmark(bm.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.judgeInputTokens).toBe(30);
    expect(failed?.judgeOutputTokens).toBe(12);
    expect(failed?.judgeCostUsd).toBeGreaterThan(0);
    expect(failed?.totalCostUsd).toBeCloseTo(
      (failed?.candidateCostUsd ?? 0) + (failed?.judgeCostUsd ?? 0),
      10,
    );
    expect(failed?.error).toContain("malformed JSON");
  });

  it("uses braidGraph as system prompt when the version has one, classicalPrompt otherwise", async () => {
    const { benchmarks, results, versions } = await buildScaffold();

    const versionWithBraid = await versions.create({
      promptId: "p1",
      version: "v2",
      classicalPrompt: "classical",
    });
    await versions.setBraidGraph(versionWithBraid.id, "graph TD\nA-->B", "openai/gpt-oss-120b");

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
      testCases: [
        {
          id: "tc1",
          input: "q1?",
          expectedOutput: null,
          category: null,
          source: "generated" as const,
        },
      ],
      promptVersionIds: ["1", versionWithBraid.id],
    });

    await runner.run(bm.id, buildContext().ctx);

    const rows = await results.listByBenchmark(bm.id);
    expect(rows).toHaveLength(2);

    const braidCall = provider.calls.find((c) =>
      (c.messages[0]?.content ?? "").includes("graph TD"),
    );
    expect(braidCall).toBeDefined();
    expect(braidCall?.messages[0]?.content).toBe("graph TD\nA-->B");

    const classicalCall = provider.calls.find((c) =>
      (c.messages[0]?.content ?? "") === "Answer concisely.",
    );
    expect(classicalCall).toBeDefined();
  });

  it("keeps a row completed when one judge in the ensemble fails", async () => {
    const { benchmarks, results, versions } = await buildScaffold();
    const provider = new RecordingProvider(() => ({
      text: "candidate answer",
      inputTokens: 3,
      outputTokens: 2,
    }));
    const judgeA = new StubJudge({ accuracy: 5, coherence: 4, instruction: 4 });
    const judgeB: IJudge = {
      grade: async () => {
        throw new JudgeExecutionError("judge-b malformed JSON", {
          usage: { inputTokens: 11, outputTokens: 7 },
          model: "openai/gpt-oss-20b",
        });
      },
    };

    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      versions,
      providers: new SingleProviderFactory(provider),
      judgeFactory: (model) => (model === "judge-a" ? judgeA : judgeB),
    });

    const bm = await queueBenchmark(benchmarks, {
      judgeModels: ["judge-a", "judge-b"],
      testCases: [
        {
          id: "tc1",
          input: "q1?",
          expectedOutput: null,
          category: null,
          source: "generated" as const,
        },
      ],
    });

    await runner.run(bm.id, buildContext().ctx);
    const [row] = await results.listByBenchmark(bm.id);
    expect(row?.status).toBe("completed");
    expect(row?.judgeVotes).toHaveLength(1);
    expect(row?.error).toContain("judge-b malformed JSON");
    expect(row?.judgeCostUsd).toBeGreaterThan(0);
  });

  it("marks remaining cells as failed when budget is exceeded", async () => {
    const { benchmarks, results, versions } = await buildScaffold();
    const provider = new RecordingProvider(() => ({
      text: "answer",
      inputTokens: 10000,
      outputTokens: 5000,
    }));
    const judge = new StubJudge({ accuracy: 5, coherence: 5, instruction: 5 });
    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      versions,
      providers: new SingleProviderFactory(provider),
      judgeFactory: () => judge,
    });

    const bm = await queueBenchmark(benchmarks, {
      budgetUsd: 0.0001,
      repetitions: 3,
      concurrency: 1,
    });
    await runner.run(bm.id, buildContext().ctx);
    const rows = await results.listByBenchmark(bm.id);
    const budgetErrors = rows.filter(
      (r) => r.status === "failed" && r.error?.includes("Budget exceeded"),
    );
    expect(budgetErrors.length).toBeGreaterThan(0);
  });

  it("counts existing spend before resuming a budget-limited benchmark", async () => {
    const { benchmarks, results, versions } = await buildScaffold();
    const provider = new RecordingProvider(() => ({
      text: "answer",
      inputTokens: 10000,
      outputTokens: 5000,
    }));
    const judge = new StubJudge({ accuracy: 5, coherence: 5, instruction: 5 });
    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      versions,
      providers: new SingleProviderFactory(provider),
      judgeFactory: () => judge,
    });

    const bm = await queueBenchmark(benchmarks, {
      budgetUsd: 0.02,
      repetitions: 2,
      concurrency: 1,
    });

    await results.upsert({
      benchmarkId: bm.id,
      testCaseId: "tc1",
      promptVersionId: "1",
      solverModel: "openai/gpt-oss-20b",
      runIndex: 0,
      input: "q1?",
      candidateOutput: "answer",
      judgeAccuracy: 5,
      judgeCoherence: 5,
      judgeInstruction: 5,
      judgeVotes: [],
      rawScore: 1,
      verbosityPenalty: 0,
      finalScore: 1,
      exactMatch: null,
      fuzzyMatchScore: null,
      candidateInputTokens: 10000,
      candidateOutputTokens: 5000,
      candidateCostUsd: 0.01,
      judgeInputTokens: 0,
      judgeOutputTokens: 0,
      judgeCostUsd: 0,
      totalCostUsd: 0.019,
      judgeFailureCount: 0,
      latencyMs: 1,
      status: "completed",
      failureKind: null,
      error: null,
    });

    await runner.run(bm.id, buildContext().ctx);
    const rows = await results.listByBenchmark(bm.id);
    const budgetErrors = rows.filter(
      (r) => r.status === "failed" && r.error?.includes("Budget exceeded"),
    );
    expect(budgetErrors.length).toBeGreaterThan(0);
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
