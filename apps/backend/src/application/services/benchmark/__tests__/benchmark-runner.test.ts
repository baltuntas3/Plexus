import { Benchmark } from "../../../../domain/entities/benchmark.js";
import type {
  GenerateRequest,
  IAIProvider,
  IAIProviderFactory,
} from "../../ai-provider.js";
import type {
  BatchJudgeInput,
  BatchJudgeResult,
  IJudge,
  JudgeUsage,
} from "../../judge/judge.js";
import { JudgeExecutionError } from "../../judge/judge.js";
import type { JobContext } from "../../job-queue.js";
import { judgeRubricAggregate } from "../../../../domain/entities/benchmark-result.js";
import { buildJudgeScore, type JudgeScore } from "../../../../domain/value-objects/judge-score.js";
import { InMemoryBenchmarkRepository } from "../../../../__tests__/fakes/in-memory-benchmark-repository.js";
import { InMemoryBenchmarkResultRepository } from "../../../../__tests__/fakes/in-memory-benchmark-result-repository.js";
import { InMemoryPromptQueryService } from "../../../../__tests__/fakes/in-memory-prompt-query-service.js";
import type { PromptVersionSummary } from "../../../../application/queries/prompt-query-service.js";
import { BenchmarkRunner } from "../benchmark-runner.js";

let versionCounter = 1;
const createVersion = (
  queries: InMemoryPromptQueryService,
  params: {
    promptId: string;
    version: string;
    sourcePrompt: string;
    braidGraph?: string;
    generatorModel?: string;
    organizationId?: string;
  },
): PromptVersionSummary => {
  const now = new Date();
  const braidGraph = params.braidGraph ?? null;
  const resolvedGeneratorModel = braidGraph
    ? params.generatorModel ?? "openai/gpt-oss-120b"
    : null;
  const organizationId = params.organizationId ?? "org-1";
  // Seed an owning prompt so org-scoped lookups succeed. The query service
  // joins versions to their prompt to enforce tenant isolation, so orphan
  // version summaries would be invisible to findVersion*InOrganization.
  queries.seedPromptSummary({
    id: params.promptId,
    name: params.promptId,
    description: "",
    taskType: "general",
    organizationId,
    creatorId: "u1",
    productionVersion: null,
    createdAt: now,
    updatedAt: now,
  });
  const summary: PromptVersionSummary = {
    id: String(versionCounter++),
    promptId: params.promptId,
    version: params.version,
    name: null,
    parentVersionId: null,
    sourcePrompt: params.sourcePrompt,
    braidGraph,
    braidGraphLayout: null,
    braidAuthorship: resolvedGeneratorModel
      ? { kind: "model", model: resolvedGeneratorModel }
      : null,
    generatorModel: resolvedGeneratorModel,
    variables: [],
    executablePrompt: braidGraph ?? params.sourcePrompt,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
  queries.seedVersionSummary(summary);
  return summary;
};

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

// Solver calls go through the provider with the runner's fixed
// SOLVER_TEMPERATURE (0.7). The runner makes no other LLM calls — the
// ensemble judge report is built deterministically from `judgeVotes`, so
// every recorded call is a solver call.
const solverCalls = (provider: RecordingProvider): GenerateRequest[] =>
  provider.calls.filter((c) => c.temperature !== 0);

class SingleProviderFactory implements IAIProviderFactory {
  constructor(private readonly provider: IAIProvider) {}
  forModel(): IAIProvider {
    return this.provider;
  }
}

// Wraps a per-candidate scoring fn into a full `IJudge`. The runner only
// calls `gradeBatch`; this helper keeps test bodies that want
// per-candidate semantics short by iterating internally and aggregating.
interface PerCandidateInput {
  input: string;
  candidate: string;
  seed?: number;
  reference?: string;
  systemPrompt?: string;
}
interface PerCandidateResult {
  score: JudgeScore;
  usage: JudgeUsage;
  model: string;
}
const judgeFromPerCandidate = (
  perCandidate: (input: PerCandidateInput) => Promise<PerCandidateResult>,
): IJudge => ({
  async gradeBatch(input) {
    const results: PerCandidateResult[] = [];
    for (const candidate of input.candidates) {
      results.push(
        await perCandidate({
          input: input.input,
          candidate,
          ...(input.seed !== undefined ? { seed: input.seed } : {}),
          ...(input.reference !== undefined ? { reference: input.reference } : {}),
          ...(input.systemPrompt !== undefined ? { systemPrompt: input.systemPrompt } : {}),
        }),
      );
    }
    return {
      scores: results.map((r) => r.score),
      usage: {
        inputTokens: results.reduce((s, r) => s + r.usage.inputTokens, 0),
        outputTokens: results.reduce((s, r) => s + r.usage.outputTokens, 0),
      },
      model: results[0]?.model ?? "stub",
    };
  },
});

class StubJudge implements IJudge {
  public calls = 0;
  // Tracks the candidate count of every gradeBatch invocation so tests can
  // assert that batching collapsed N reps into a single call.
  public batchSizes: number[] = [];
  constructor(
    private readonly score: { accuracy: number; coherence: number; instruction: number },
    private readonly judgeModel = "openai/gpt-oss-20b",
  ) {}
  async gradeBatch(input: BatchJudgeInput): Promise<BatchJudgeResult> {
    this.calls += 1;
    this.batchSizes.push(input.candidates.length);
    return {
      scores: input.candidates.map(() =>
        buildJudgeScore(this.score, "stub reasoning"),
      ),
      usage: {
        inputTokens: 20 * input.candidates.length,
        outputTokens: 10 * input.candidates.length,
      },
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
  const queries = new InMemoryPromptQueryService();
  // Reset so the first seeded version always has id "1" — matches
  // queueBenchmark's default versionId — and benchmark ids stay predictable.
  versionCounter = 1;
  benchmarkIdSeq = 1;

  const version = createVersion(queries, {
    promptId: "p1",
    version: "v1",
    sourcePrompt: "Answer concisely.",
  });

  return { benchmarks, results, queries, version };
};

// Test-only override surface. The aggregate's `create` factory takes the
// full config; tests use this loose shape because each case only cares
// about the knobs it mutates.
type BenchmarkTestOverrides = {
  name?: string;
  organizationId?: string;
  creatorId?: string;
  promptVersionIds?: string[];
  solverModels?: string[];
  judgeModels?: string[];
  generatorModel?: string;
  testGenerationMode?: Benchmark["testGenerationMode"];
  taskType?: Benchmark["taskType"];
  costForecast?: Benchmark["costForecast"];
  repetitions?: number;
  seed?: number;
  testCases?: Benchmark["testCases"][number][];
  concurrency?: number;
  cellTimeoutMs?: number | null;
  budgetUsd?: number | null;
};

let benchmarkIdSeq = 1;
const queueBenchmark = async (
  benchmarks: InMemoryBenchmarkRepository,
  overrides: BenchmarkTestOverrides = {},
  versionId = "1",
): Promise<Benchmark> => {
  const benchmark = Benchmark.create({
    id: `bm-${benchmarkIdSeq++}`,
    name: overrides.name ?? "bm",
    organizationId: overrides.organizationId ?? "org-1",
    creatorId: overrides.creatorId ?? "u1",
    promptVersionIds: overrides.promptVersionIds ?? [versionId],
    solverModels: overrides.solverModels ?? ["openai/gpt-oss-20b"],
    judgeModels: overrides.judgeModels ?? ["openai/gpt-oss-20b"],
    generatorModel: overrides.generatorModel ?? "openai/gpt-oss-20b",
    testGenerationMode: overrides.testGenerationMode ?? "shared-core",
    taskType: overrides.taskType ?? "general",
    costForecast: overrides.costForecast ?? null,
    repetitions: overrides.repetitions ?? 1,
    seed: overrides.seed ?? 42,
    testCases: overrides.testCases ?? TEST_CASES,
    concurrency: overrides.concurrency ?? 2,
    cellTimeoutMs: overrides.cellTimeoutMs ?? null,
    budgetUsd: overrides.budgetUsd ?? null,
  });
  await benchmarks.save(benchmark);
  return benchmark;
};

describe("BenchmarkRunner.run", () => {
  it("executes the full matrix, records results, and marks the benchmark completed", async () => {
    const { benchmarks, results, queries } = await buildScaffold();
    const provider = new RecordingProvider(() => ({
      text: "answer",
      inputTokens: 100,
      outputTokens: 50,
    }));
    const judge = new StubJudge({ accuracy: 5, coherence: 4, instruction: 4 });
    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      promptQueries: queries,
      providers: new SingleProviderFactory(provider),
      judgeFactory: () => judge,
    });

    const bm = await queueBenchmark(benchmarks);
    const { ctx, events } = buildContext();
    await runner.run(bm.id, ctx);

    expect(solverCalls(provider)).toHaveLength(2);
    expect(judge.calls).toBe(2);

    const rows = await results.listByBenchmark(bm.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "completed")).toBe(true);
    expect(rows.every((r) => judgeRubricAggregate(r.judgeVotes).finalScore > 0)).toBe(true);
    expect(rows.every((r) => r.judgeFailureCount === 0)).toBe(true);

    const final = await benchmarks.findById(bm.id);
    expect(final?.status).toBe("completed");
    expect(final?.progress).toEqual({ completed: 2, total: 2 });
    expect(final?.jobId).toBe("job-1");
    expect(final?.completedAt).not.toBeNull();

    expect(events.at(-1)).toEqual({ completed: 2, total: 2 });
  });

  it("repeats each cell k times with distinct seeds so variance can be measured", async () => {
    const { benchmarks, results, queries } = await buildScaffold();
    const provider = new RecordingProvider(() => ({
      text: "answer",
      inputTokens: 1,
      outputTokens: 1,
    }));
    const judge = new StubJudge({ accuracy: 5, coherence: 5, instruction: 5 });
    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      promptQueries: queries,
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
    const seeds = new Set(solverCalls(provider).map((c) => c.seed));
    expect(seeds.size).toBe(6);
  });

  it("passes deterministic batch-judge seeds so reruns are reproducible", async () => {
    const { benchmarks, results, queries } = await buildScaffold();
    const solverProvider = new RecordingProvider(() => ({
      text: "answer",
      inputTokens: 1,
      outputTokens: 1,
    }));
    // The runner now batches all reps of a single (testCase, version,
    // solver) triple into ONE judge call, so the response payload must be
    // in the batched shape (one entry per ATTEMPT label).
    const judgeProvider = new RecordingProvider(() => ({
      text: JSON.stringify({
        scores: [
          { label: "ATTEMPT_1", accuracy: 5, coherence: 5, instruction: 5, reasoning: "ok" },
          { label: "ATTEMPT_2", accuracy: 5, coherence: 5, instruction: 5, reasoning: "ok" },
        ],
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
      promptQueries: queries,
      providers,
    });

    const bm = await queueBenchmark(benchmarks, {
      judgeModels: ["judge-model"],
      repetitions: 2,
      concurrency: 1,
    });
    await runner.run(bm.id, buildContext().ctx);

    // 2 testCases × 1 version × 1 solver × 1 judge = 2 batched judge calls
    // (each scoring both reps in a single round-trip).
    expect(judgeProvider.calls).toHaveLength(2);
    expect(new Set(judgeProvider.calls.map((call) => call.seed)).size).toBe(2);
    expect(judgeProvider.calls.every((call) => call.seed !== undefined)).toBe(true);
  });

  it("preserves batched judge token remainders across persisted rows", async () => {
    const { benchmarks, results, queries } = await buildScaffold();
    const provider = new RecordingProvider(() => ({
      text: "answer",
      inputTokens: 1,
      outputTokens: 1,
    }));
    const judge: IJudge = {
      async gradeBatch(input) {
        return {
          scores: input.candidates.map(() =>
            buildJudgeScore(
              { accuracy: 5, coherence: 5, instruction: 5 },
              "stub reasoning",
            ),
          ),
          usage: { inputTokens: 11, outputTokens: 7 },
          model: "openai/gpt-oss-20b",
        };
      },
    };
    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      promptQueries: queries,
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
      repetitions: 3,
      concurrency: 1,
    });

    await runner.run(bm.id, buildContext().ctx);
    const rows = (await results.listByBenchmark(bm.id)).sort(
      (a, b) => a.runIndex - b.runIndex,
    );

    expect(rows.map((row) => row.judgeInputTokens)).toEqual([4, 4, 3]);
    expect(rows.map((row) => row.judgeOutputTokens)).toEqual([3, 2, 2]);
    expect(rows.reduce((sum, row) => sum + row.judgeInputTokens, 0)).toBe(11);
    expect(rows.reduce((sum, row) => sum + row.judgeOutputTokens, 0)).toBe(7);
    expect(rows.reduce((sum, row) => sum + row.judgeCostUsd, 0)).toBeGreaterThan(0);
  });

  it("scores rows purely from rubric — candidate length never penalises finalScore", async () => {
    // Length expectations belong in the prompt; the judge's `instruction`
    // axis already grades whether the candidate respected them. The runner
    // must NOT apply any length-based penalty on top of the rubric mean.
    const { benchmarks, results, queries } = await buildScaffold();
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
      promptQueries: queries,
      providers: new SingleProviderFactory(provider),
      judgeFactory: () => judge,
    });

    const bm = await queueBenchmark(benchmarks, {
      testCases: [
        { id: "tc1", input: "q1?", expectedOutput: null, category: null, source: "generated" },
      ],
      promptVersionIds: [
        "1",
        (createVersion(queries, {
          promptId: "p1",
          version: "v2",
          sourcePrompt: "Answer with more detail when useful.",
        })).id,
        (createVersion(queries, {
          promptId: "p1",
          version: "v3",
          sourcePrompt: "Keep answers compact.",
        })).id,
      ],
      concurrency: 1,
    });

    await runner.run(bm.id, buildContext().ctx);
    const rows = await results.listByBenchmark(bm.id);
    expect(rows.every((row) => judgeRubricAggregate(row.judgeVotes).finalScore === 1)).toBe(true);
  });

  it("grades every row with every judge in the ensemble and averages their scores", async () => {
    const { benchmarks, results, queries } = await buildScaffold();
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
      promptQueries: queries,
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
    const rubric = judgeRubricAggregate(row.judgeVotes);
    expect(rubric.accuracy).toBeCloseTo(4, 6);
    expect(rubric.coherence).toBeCloseTo(4, 6);
    expect(rubric.instruction).toBeCloseTo(4, 6);
  });

  it("passes expected output as reference to the judge when present", async () => {
    const { benchmarks, results, queries } = await buildScaffold();
    const gradeCalls: { reference?: string }[] = [];
    const judge: IJudge = judgeFromPerCandidate(async (input) => {
      gradeCalls.push({ reference: input.reference });
      return {
        score: buildJudgeScore({ accuracy: 5, coherence: 5, instruction: 5 }, "ok"),
        usage: { inputTokens: 10, outputTokens: 5 },
        model: "openai/gpt-oss-20b",
      };
    });
    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      promptQueries: queries,
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
    const { benchmarks, results, queries } = await buildScaffold();
    const provider = new RecordingProvider(() => ({
      text: "answer",
      inputTokens: 10,
      outputTokens: 10,
    }));
    const judge = new StubJudge({ accuracy: 5, coherence: 5, instruction: 5 });
    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      promptQueries: queries,
      providers: new SingleProviderFactory(provider),
      judgeFactory: () => judge,
    });

    const bm = await queueBenchmark(benchmarks);
    await runner.run(bm.id, buildContext().ctx);
    expect(solverCalls(provider)).toHaveLength(2);

    await runner.run(bm.id, buildContext().ctx);
    expect(solverCalls(provider)).toHaveLength(2);
    expect(judge.calls).toBe(2);
    const rows = await results.listByBenchmark(bm.id);
    expect(rows).toHaveLength(2);
  });

  it("keeps a row completed when at least one judge succeeds", async () => {
    const { benchmarks, results, queries } = await buildScaffold();
    const provider = new RecordingProvider(() => ({
      text: "answer",
      inputTokens: 5,
      outputTokens: 5,
    }));

    let judgeCall = 0;
    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      promptQueries: queries,
      providers: new SingleProviderFactory(provider),
      judgeFactory: () =>
        judgeFromPerCandidate(async () => {
          judgeCall += 1;
          if (judgeCall === 2) {
            throw new JudgeExecutionError("judge parse failed", {
              usage: { inputTokens: 11, outputTokens: 7 },
              model: "openai/gpt-oss-120b",
            });
          }
          return {
            score: buildJudgeScore(
              { accuracy: 5, coherence: 4, instruction: 4 },
              "ok",
            ),
            usage: { inputTokens: 10, outputTokens: 6 },
            model: "openai/gpt-oss-20b",
          };
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

  it("retries previously failed rows on resume", async () => {
    const { benchmarks, results, queries } = await buildScaffold();
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
      promptQueries: queries,
      providers: new SingleProviderFactory(provider),
      judgeFactory: () => judge,
    });

    const bm = await queueBenchmark(benchmarks, { concurrency: 1 });
    await runner.run(bm.id, buildContext().ctx);
    expect(solverCalls(provider)).toHaveLength(2);

    await runner.run(bm.id, buildContext().ctx);
    expect(solverCalls(provider)).toHaveLength(3);

    const rows = await results.listByBenchmark(bm.id);
    expect(rows.filter((row) => row.status === "failed")).toHaveLength(0);
    expect(rows.filter((row) => row.status === "completed")).toHaveLength(2);
  });

  it("captures per-cell errors as failed rows without aborting the benchmark", async () => {
    const { benchmarks, results, queries } = await buildScaffold();

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
      promptQueries: queries,
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
    const { benchmarks, results, queries } = await buildScaffold();

    const provider = new RecordingProvider(() => ({
      text: "candidate answer",
      inputTokens: 12,
      outputTokens: 8,
    }));
    const judge: IJudge = judgeFromPerCandidate(async () => {
      throw new Error("judge exploded");
    });

    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      promptQueries: queries,
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
    expect(failed?.solverLatencyMs).toBeGreaterThanOrEqual(0);
    expect(failed?.error).toContain("judge exploded");
  });

  it("preserves partial judge token usage and cost when judge parsing fails after generation", async () => {
    const { benchmarks, results, queries } = await buildScaffold();
    const provider = new RecordingProvider(() => ({
      text: "candidate answer",
      inputTokens: 10,
      outputTokens: 5,
    }));
    const judge: IJudge = judgeFromPerCandidate(async () => {
      throw new JudgeExecutionError("judge returned malformed JSON", {
        usage: { inputTokens: 31, outputTokens: 13 },
        model: "openai/gpt-oss-20b",
      });
    });

    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      promptQueries: queries,
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
      repetitions: 3,
      concurrency: 1,
    });

    await runner.run(bm.id, buildContext().ctx);
    const failedRows = (await results.listByBenchmark(bm.id)).sort(
      (a, b) => a.runIndex - b.runIndex,
    );
    expect(failedRows).toHaveLength(3);
    expect(failedRows.every((row) => row.status === "failed")).toBe(true);
    expect(failedRows.map((row) => row.judgeInputTokens)).toEqual([11, 10, 10]);
    expect(failedRows.map((row) => row.judgeOutputTokens)).toEqual([5, 4, 4]);
    expect(failedRows.reduce((sum, row) => sum + row.judgeInputTokens, 0)).toBe(31);
    expect(failedRows.reduce((sum, row) => sum + row.judgeOutputTokens, 0)).toBe(13);
    expect(failedRows.every((row) => row.judgeCostUsd > 0)).toBe(true);
    for (const failed of failedRows) {
      expect(failed.totalCostUsd).toBeCloseTo(
        failed.candidateCostUsd + failed.judgeCostUsd,
        10,
      );
      expect(failed.error).toContain("malformed JSON");
    }
  });

  it("uses braidGraph as system prompt when the version has one, sourcePrompt otherwise", async () => {
    const { benchmarks, results, queries } = await buildScaffold();

    const versionWithBraid = createVersion(queries, {
      promptId: "p1",
      version: "v2",
      sourcePrompt: "classical",
      braidGraph: "graph TD\nA[start] --> B[end]",
      generatorModel: "openai/gpt-oss-120b",
    });

    const provider = new RecordingProvider((req) => ({
      text: `seen:${req.messages[0]?.content?.slice(0, 8) ?? ""}`,
      inputTokens: 1,
      outputTokens: 1,
    }));
    const judge = new StubJudge({ accuracy: 3, coherence: 3, instruction: 3 });

    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      promptQueries: queries,
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

    // BRAID versions are wrapped at runtime so the model treats the
    // mermaid graph as a workflow to execute silently rather than narrate.
    // The wrapper is fixed (same for every BRAID version) and includes
    // the original graph verbatim, so we check both.
    const braidCall = provider.calls.find((c) =>
      (c.messages[0]?.content ?? "").includes("graph TD"),
    );
    expect(braidCall).toBeDefined();
    expect(braidCall?.messages[0]?.content).toContain("graph TD\nA[start] --> B[end]");
    expect(braidCall?.messages[0]?.content).toContain("OUTPUT ONLY THE FINAL RESULT");

    const classicalCall = provider.calls.find((c) =>
      (c.messages[0]?.content ?? "") === "Answer concisely.",
    );
    expect(classicalCall).toBeDefined();
  });

  it("keeps a row completed when one judge in the ensemble fails", async () => {
    const { benchmarks, results, queries } = await buildScaffold();
    const provider = new RecordingProvider(() => ({
      text: "candidate answer",
      inputTokens: 3,
      outputTokens: 2,
    }));
    const judgeA = new StubJudge({ accuracy: 5, coherence: 4, instruction: 4 });
    const judgeB: IJudge = judgeFromPerCandidate(async () => {
      throw new JudgeExecutionError("judge-b malformed JSON", {
        usage: { inputTokens: 11, outputTokens: 7 },
        model: "openai/gpt-oss-20b",
      });
    });

    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      promptQueries: queries,
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

  it("stops at a per-testCase bucket boundary so completed testCases keep version balance", async () => {
    // Triple batching makes the budget gate work at testCase-bucket
    // granularity: a bucket either runs all of its (version × solver)
    // triples or none. The fairness contract is therefore "every completed
    // testCase has full version coverage", instead of the old "every
    // version has full testCase coverage at runIndex 0".
    const { benchmarks, results, queries } = await buildScaffold();
    const provider = new RecordingProvider(() => ({
      text: "answer",
      inputTokens: 10000,
      outputTokens: 5000,
    }));
    const judge = new StubJudge({ accuracy: 5, coherence: 5, instruction: 5 });
    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      promptQueries: queries,
      providers: new SingleProviderFactory(provider),
      judgeFactory: () => judge,
    });

    const bm = await queueBenchmark(benchmarks, {
      budgetUsd: 0.005,
      repetitions: 3,
      concurrency: 1,
      testCases: [
        { id: "tc1", input: "q1?", expectedOutput: null, category: null, source: "generated" as const },
        { id: "tc2", input: "q2?", expectedOutput: null, category: null, source: "generated" as const },
      ],
      promptVersionIds: [
        "1",
        (createVersion(queries, {
          promptId: "p1",
          version: "v2",
          sourcePrompt: "Answer with extra detail.",
        })).id,
      ],
    });
    await runner.run(bm.id, buildContext().ctx);

    const final = await benchmarks.findById(bm.id);
    const rows = await results.listByBenchmark(bm.id);
    expect(final?.status).toBe("completed_with_budget_cap");
    // First bucket (tc1) completes both versions × all reps = 6 rows;
    // second bucket (tc2) is skipped because the projected spend exceeds
    // the cap.
    expect(rows).toHaveLength(6);

    const coveredTestCases = new Set(rows.map((row) => row.testCaseId));
    expect(coveredTestCases.size).toBe(1);

    const completedByVersion = new Map<string, number>();
    for (const row of rows) {
      completedByVersion.set(
        row.promptVersionId,
        (completedByVersion.get(row.promptVersionId) ?? 0) + (row.status === "completed" ? 1 : 0),
      );
    }
    expect([...completedByVersion.values()].sort()).toEqual([3, 3]);
  });

  it("batches all repetitions of a triple into a single judge call", async () => {
    const { benchmarks, results, queries } = await buildScaffold();
    const provider = new RecordingProvider(() => ({
      text: "answer",
      inputTokens: 1,
      outputTokens: 1,
    }));
    const judge = new StubJudge({ accuracy: 5, coherence: 5, instruction: 5 });
    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      promptQueries: queries,
      providers: new SingleProviderFactory(provider),
      judgeFactory: () => judge,
    });

    const bm = await queueBenchmark(benchmarks, {
      repetitions: 3,
      concurrency: 1,
      testCases: [
        { id: "tc1", input: "q1?", expectedOutput: null, category: null, source: "generated" as const },
      ],
    });
    await runner.run(bm.id, buildContext().ctx);

    // 1 testCase × 1 version × 1 solver × 1 judge → 1 batched judge call;
    // 3 reps mean 3 solver calls AND a single batch of 3 candidates fed
    // to the judge in one round-trip.
    expect(solverCalls(provider)).toHaveLength(3);
    expect(judge.calls).toBe(1);
    expect(judge.batchSizes).toEqual([3]);

    const rows = await results.listByBenchmark(bm.id);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === "completed")).toBe(true);
    // Per-row judge cost is the equal split of the shared judge call's
    // total cost, so the 3 rep rows must agree to within float precision.
    const judgeCosts = rows.map((r) => r.judgeCostUsd);
    expect(Math.max(...judgeCosts) - Math.min(...judgeCosts)).toBeLessThan(1e-12);
  });

  it("counts existing spend before resuming a budget-limited benchmark", async () => {
    const { benchmarks, results, queries } = await buildScaffold();
    const provider = new RecordingProvider(() => ({
      text: "answer",
      inputTokens: 10000,
      outputTokens: 5000,
    }));
    const judge = new StubJudge({ accuracy: 5, coherence: 5, instruction: 5 });
    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      promptQueries: queries,
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
      candidateOutput: "answer",
      judgeVotes: [
        {
          model: "judge-1",
          accuracy: 5,
          coherence: 5,
          instruction: 5,
          reasoning: "",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
        },
      ],
      candidateInputTokens: 10000,
      candidateOutputTokens: 5000,
      candidateCostUsd: 0.01,
      judgeInputTokens: 0,
      judgeOutputTokens: 0,
      judgeCostUsd: 0,
      totalCostUsd: 0.019,
      judgeFailureCount: 0,
      solverLatencyMs: 1,
      status: "completed",
      failureKind: null,
      error: null,
    });

    await runner.run(bm.id, buildContext().ctx);
    const final = await benchmarks.findById(bm.id);
    const rows = await results.listByBenchmark(bm.id);
    expect(final?.status).toBe("completed_with_budget_cap");
    expect(rows).toHaveLength(1);
  });

  it("marks the benchmark failed when it has no test cases", async () => {
    const { benchmarks, results, queries } = await buildScaffold();
    const runner = new BenchmarkRunner({
      benchmarks,
      results,
      promptQueries: queries,
      providers: new SingleProviderFactory(
        new RecordingProvider(() => ({ text: "x", inputTokens: 1, outputTokens: 1 })),
      ),
      judgeFactory: () => new StubJudge({ accuracy: 5, coherence: 5, instruction: 5 }),
    });

    const bm = await queueBenchmark(benchmarks, { testCases: [] });
    await expect(runner.run(bm.id, buildContext().ctx)).rejects.toMatchObject({
      code: "BENCHMARK_MATRIX_EMPTY",
    });
    const final = await benchmarks.findById(bm.id);
    expect(final?.status).toBe("failed");
  });
});
