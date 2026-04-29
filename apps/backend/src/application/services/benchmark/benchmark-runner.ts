import type { Benchmark } from "../../../domain/entities/benchmark.js";
import {
  benchmarkResultKey,
  completedBenchmarkResult,
  failedBenchmarkResult,
  type BenchmarkFailureKind,
  type CompletedResultInput,
  type FailedResultInput,
  type JudgeVote,
  type UpsertableBenchmarkResult,
} from "../../../domain/entities/benchmark-result.js";
import type { PromptVersionSummary } from "../../queries/prompt-query-service.js";
import { NotFoundError } from "../../../domain/errors/domain-error.js";
import { BenchmarkMatrix, type MatrixCell } from "../../../domain/value-objects/benchmark-matrix.js";
import type { IBenchmarkRepository } from "../../../domain/repositories/benchmark-repository.js";
import type { IBenchmarkResultRepository } from "../../../domain/repositories/benchmark-result-repository.js";
import type { IPromptQueryService } from "../../queries/prompt-query-service.js";
import { JudgeScore } from "../../../domain/value-objects/judge-score.js";
import { mapConcurrent } from "../../utils/map-concurrent.js";
import type { IAIProviderFactory, GenerateResponse } from "../ai-provider.js";
import type { JobContext } from "../job-queue.js";
import { calculateCost } from "../model-registry.js";
import { LLMJudge } from "../judge/llm-judge.js";
import { JudgeExecutionError, type IJudge } from "../judge/judge.js";
import { buildEvaluationPrompt } from "./evaluation-prompt.js";

// Orchestrates a single benchmark run end-to-end against the Benchmark
// aggregate. The runner only performs lifecycle transitions through domain
// methods (`start`, `recordProgress`, `completeNormally`,
// `completeWithBudgetCap`, `failWith`), so illegal state moves surface as
// typed domain errors rather than as silent inconsistency in the store.
//
// The matrix is (testCase × promptVersion × solverModel × runIndex). Test
// cases are embedded on the Benchmark aggregate; each logical cell is
// repeated `benchmark.repetitions` times so the analyzer can estimate
// within-candidate variance.
//
// Every row is graded by every judge in `benchmark.judgeModels`; rubric
// means are stored on the row, individual votes on `judgeVotes` for
// drill-down and bias analysis. Per-cell failures are captured as "failed"
// rows so a partial matrix is still useful.

const DEFAULT_CELL_TIMEOUT_MS = 120_000;
const DEFAULT_BUDGET_USD = 50;

interface CellSlice {
  sampleKey: string;
  runIndex: number;
  cells: MatrixCell[];
}

export interface BenchmarkRunnerDeps {
  benchmarks: IBenchmarkRepository;
  results: IBenchmarkResultRepository;
  promptQueries: IPromptQueryService;
  providers: IAIProviderFactory;
  // Seam for tests — production path instantiates LLMJudge per judge model.
  judgeFactory?: (model: string, taskType: Benchmark["taskType"]) => IJudge;
}

export class BenchmarkRunner {
  constructor(private readonly deps: BenchmarkRunnerDeps) {}

  async run(benchmarkId: string, ctx: JobContext): Promise<void> {
    let benchmark = await this.deps.benchmarks.findById(benchmarkId);
    if (!benchmark) throw NotFoundError(`Benchmark ${benchmarkId} not found`);

    // Resume path: a completed or failed benchmark is re-runnable. The
    // aggregate's `queue()` rule rejects the "already queued" / "already
    // running" cases, so this transition is safe — the runner does not need
    // to reimplement that logic inline.
    if (
      benchmark.status !== "queued" &&
      benchmark.status !== "running" &&
      benchmark.status !== "draft"
    ) {
      benchmark.queue();
    }
    benchmark.start(ctx.jobId);
    await this.deps.benchmarks.save(benchmark);

    try {
      benchmark.assertRunnable();
      const versions = await this.loadVersions(
        [...benchmark.promptVersionIds],
        benchmark.organizationId,
      );
      const matrix = BenchmarkMatrix.build({
        testCases: benchmark.testCases,
        versions,
        solverModels: [...benchmark.solverModels],
        judgeModels: [...benchmark.judgeModels],
        repetitions: benchmark.repetitions,
      });

      const cells = [...matrix.cells];
      const estimatedCellCostUsd = estimateCellCostUsd(benchmark, cells.length);
      const existingRows = await this.deps.results.listByBenchmark(benchmarkId);
      const existingByKey = new Map(
        existingRows.map((row) => [resultKey(row), row] as const),
      );
      const total = cells.length;
      let processed = cells.reduce((sum, cell) => {
        const row = existingByKey.get(cellKey(cell));
        return sum + (row?.status === "completed" ? 1 : 0);
      }, 0);

      benchmark.recordProgress(processed, total);
      await this.deps.benchmarks.save(benchmark);
      await ctx.reportProgress({ completed: processed, total });

      const pending = cells.filter(
        (cell) => existingByKey.get(cellKey(cell))?.status !== "completed",
      );
      const slices = buildSlices(pending, benchmark.seed);
      const judges = this.buildJudges(benchmark.judgeModels, benchmark.taskType);
      const cellTimeout = benchmark.cellTimeoutMs ?? DEFAULT_CELL_TIMEOUT_MS;
      const budget = benchmark.budgetUsd ?? DEFAULT_BUDGET_USD;
      let spentUsd = existingRows.reduce(
        (sum, row) => sum + row.totalCostUsd,
        0,
      );
      let observedCellCosts = spentUsd;
      let observedCellCount = existingRows.length;
      let cappedByBudget = false;

      const reservePerCellUsd = (): number =>
        observedCellCount > 0
          ? observedCellCosts / observedCellCount
          : estimatedCellCostUsd;

      for (const slice of slices) {
        const estimatedSliceCostUsd = reservePerCellUsd() * slice.cells.length;
        if (spentUsd + estimatedSliceCostUsd > budget) {
          cappedByBudget = true;
          break;
        }
        await mapConcurrent(
          slice.cells,
          Math.max(1, benchmark.concurrency),
          async (cell) => {
            const row = await withTimeout(
              this.runCell(benchmark!, cell, judges),
              cellTimeout,
            ).catch((err) =>
              failedBenchmarkResult({
                benchmarkId: benchmark!.id,
                testCaseId: cell.testCase.id,
                promptVersionId: cell.version.id,
                solverModel: cell.solverModel,
                runIndex: cell.runIndex,
                input: cell.testCase.input,
                error: err instanceof Error ? err.message : String(err),
                failureKind: classifyFailureKind(err),
              }),
            );
            spentUsd += row.totalCostUsd;
            observedCellCosts += row.totalCostUsd;
            observedCellCount += 1;
            await this.deps.results.upsert(row);
            processed += 1;
            benchmark = await this.reloadAndReport(
              benchmarkId,
              ctx,
              processed,
              total,
            );
          },
        );
      }

      // Final transition. Reload to pick up the latest persisted revision
      // (progress ticks advance it) before recording completion.
      benchmark = await this.requireBenchmark(benchmarkId);
      if (cappedByBudget) {
        benchmark.completeWithBudgetCap(
          `Stopped at the $${budget.toFixed(2)} budget cap after completing ` +
            `${processed}/${total} cells with balanced coverage.`,
        );
      } else {
        benchmark.completeNormally();
      }
      await this.deps.benchmarks.save(benchmark);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const latest = await this.deps.benchmarks.findById(benchmarkId);
      if (latest) {
        latest.failWith(message);
        await this.deps.benchmarks.save(latest);
      }
      throw err;
    }
  }

  private async reloadAndReport(
    benchmarkId: string,
    ctx: JobContext,
    completed: number,
    total: number,
  ): Promise<Benchmark> {
    const latest = await this.requireBenchmark(benchmarkId);
    latest.recordProgress(completed, total);
    await this.deps.benchmarks.save(latest);
    await ctx.reportProgress({ completed, total });
    return latest;
  }

  private async requireBenchmark(id: string): Promise<Benchmark> {
    const latest = await this.deps.benchmarks.findById(id);
    if (!latest) {
      throw NotFoundError(`Benchmark ${id} not found`);
    }
    return latest;
  }

  private async loadVersions(
    ids: readonly string[],
    organizationId: string,
  ): Promise<PromptVersionSummary[]> {
    const found = await this.deps.promptQueries.findVersionSummariesByIdsInOrganization(
      ids,
      organizationId,
    );
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw NotFoundError(`PromptVersion(s) not found: ${missing.join(", ")}`);
    }
    return ids.map((id) => found.get(id) as PromptVersionSummary);
  }

  private buildJudges(
    models: readonly string[],
    taskType: Benchmark["taskType"],
  ): Array<{ model: string; judge: IJudge }> {
    return models.map((model) => ({
      model,
      judge: this.deps.judgeFactory
        ? this.deps.judgeFactory(model, taskType)
        : new LLMJudge(this.deps.providers, { judgeModel: model, taskType }),
    }));
  }

  private async runCell(
    benchmark: Benchmark,
    cell: MatrixCell,
    judges: ReadonlyArray<{ model: string; judge: IJudge }>,
  ): Promise<UpsertableBenchmarkResult> {
    const systemPrompt = buildEvaluationPrompt(cell.version);
    const provider = this.deps.providers.forModel(cell.solverModel);

    const solverSeed = deriveSeed(benchmark.seed, cell);

    const start = Date.now();
    let candidate: GenerateResponse;
    try {
      candidate = await provider.generate({
        model: cell.solverModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: cell.testCase.input },
        ],
        temperature: benchmark.solverTemperature,
        seed: solverSeed,
      });
    } catch (err) {
      return failedBenchmarkResult(
        buildFailedInput(benchmark.id, cell, err, {
          latencyMs: Date.now() - start,
          failureKind: "solver_error",
        }),
      );
    }
    const latencyMs = Date.now() - start;
    const candidateCost = calculateCost(
      cell.solverModel,
      candidate.usage.inputTokens,
      candidate.usage.outputTokens,
    );

    const judgeExecution = await Promise.all(
      judges.map(async ({ model, judge }) => {
        try {
          const graded = await judge.grade({
            input: cell.testCase.input,
            candidate: candidate.text,
            seed: deriveJudgeSeed(benchmark.seed, cell, model),
            reference: cell.testCase.expectedOutput ?? undefined,
            systemPrompt,
          });
          const judgeCost = calculateCost(
            graded.model,
            graded.usage.inputTokens,
            graded.usage.outputTokens,
          );
          const vote: JudgeVote = {
            model,
            accuracy: graded.score.rubric.accuracy,
            coherence: graded.score.rubric.coherence,
            instruction: graded.score.rubric.instruction,
            reasoning: graded.score.reasoning,
            inputTokens: graded.usage.inputTokens,
            outputTokens: graded.usage.outputTokens,
            costUsd: judgeCost.totalUsd,
          };
          return { ok: true as const, vote, graded };
        } catch (err) {
          const partial =
            err instanceof JudgeExecutionError
              ? buildPartialJudgeUsage(model, err)
              : null;
          return { ok: false as const, err, partial };
        }
      }),
    );

    const judgeFailures = judgeExecution.filter((j) => !j.ok);
    const votes = judgeExecution.filter(
      (j): j is Extract<typeof judgeExecution[number], { ok: true }> => j.ok,
    );
    const successfulJudgeInputTokens = votes.reduce(
      (sum, vote) => sum + vote.vote.inputTokens,
      0,
    );
    const successfulJudgeOutputTokens = votes.reduce(
      (sum, vote) => sum + vote.vote.outputTokens,
      0,
    );
    const successfulJudgeCostUsd = votes.reduce(
      (sum, vote) => sum + vote.vote.costUsd,
      0,
    );
    const partialJudgeInputTokens = judgeFailures.reduce(
      (sum, failure) => sum + (failure.partial?.inputTokens ?? 0),
      0,
    );
    const partialJudgeOutputTokens = judgeFailures.reduce(
      (sum, failure) => sum + (failure.partial?.outputTokens ?? 0),
      0,
    );
    const partialJudgeCostUsd = judgeFailures.reduce(
      (sum, failure) => sum + (failure.partial?.costUsd ?? 0),
      0,
    );
    const judgeInputTokens = successfulJudgeInputTokens + partialJudgeInputTokens;
    const judgeOutputTokens =
      successfulJudgeOutputTokens + partialJudgeOutputTokens;
    const judgeCostUsd = successfulJudgeCostUsd + partialJudgeCostUsd;

    if (votes.length === 0) {
      const firstFailure = judgeFailures[0];
      return failedBenchmarkResult(
        buildFailedInput(
          benchmark.id,
          cell,
          firstFailure?.err ?? new Error("Judge ensemble incomplete"),
          {
            latencyMs,
            candidate,
            candidateCostUsd: candidateCost.totalUsd,
            judgeInputTokens,
            judgeOutputTokens,
            judgeCostUsd,
            failureKind: "judge_error",
          },
        ),
      );
    }

    const meanAccuracy = mean(votes.map((v) => v.vote.accuracy));
    const meanCoherence = mean(votes.map((v) => v.vote.coherence));
    const meanInstruction = mean(votes.map((v) => v.vote.instruction));
    const meanVerbosityPenalty = mean(
      votes.map((v) => v.graded.score.verbosityPenalty),
    );
    const score = JudgeScore.fromRubric(
      {
        accuracy: meanAccuracy,
        coherence: meanCoherence,
        instruction: meanInstruction,
      },
      meanVerbosityPenalty,
      "",
    );

    const completed: CompletedResultInput = {
      benchmarkId: benchmark.id,
      testCaseId: cell.testCase.id,
      promptVersionId: cell.version.id,
      solverModel: cell.solverModel,
      runIndex: cell.runIndex,
      input: cell.testCase.input,
      candidateOutput: candidate.text,
      candidateInputTokens: candidate.usage.inputTokens,
      candidateOutputTokens: candidate.usage.outputTokens,
      candidateCostUsd: candidateCost.totalUsd,
      judgeAccuracy: meanAccuracy,
      judgeCoherence: meanCoherence,
      judgeInstruction: meanInstruction,
      judgeVotes: votes.map((v) => v.vote),
      rawScore: score.rawScore,
      verbosityPenalty: meanVerbosityPenalty,
      finalScore: score.finalScore,
      judgeInputTokens,
      judgeOutputTokens,
      judgeCostUsd,
      judgeFailureCount: judgeFailures.length,
      latencyMs,
      partialJudgeFailureMessage:
        judgeFailures.length === 0
          ? null
          : `Partial judge failure: ${judgeFailures.length}/${judges.length} judge(s) failed. ${judgeFailures
              .map((failure) =>
                failure.err instanceof Error
                  ? failure.err.message
                  : String(failure.err),
              )
              .join("; ")}`,
    };
    return completedBenchmarkResult(completed);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

class CellTimeoutError extends Error {
  constructor(ms: number) {
    super(`Cell timed out after ${ms}ms`);
    this.name = "CellTimeoutError";
  }
}

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new CellTimeoutError(ms)), ms);
      timer.unref?.();
    }),
  ]);
};

const cellKey = (cell: MatrixCell): string =>
  benchmarkResultKey(
    cell.testCase.id,
    cell.version.id,
    cell.solverModel,
    cell.runIndex,
  );

const sampleKey = (cell: MatrixCell): string =>
  `${cell.testCase.id}::${cell.runIndex}`;

const resultKey = (
  row: Pick<
    UpsertableBenchmarkResult,
    "testCaseId" | "promptVersionId" | "solverModel" | "runIndex"
  >,
): string =>
  benchmarkResultKey(
    row.testCaseId,
    row.promptVersionId,
    row.solverModel,
    row.runIndex,
  );

const buildFailedInput = (
  benchmarkId: string,
  cell: MatrixCell,
  err: unknown,
  partial: {
    latencyMs?: number;
    candidate?: GenerateResponse;
    candidateCostUsd?: number;
    judgeInputTokens?: number;
    judgeOutputTokens?: number;
    judgeCostUsd?: number;
    judgeFailureCount?: number;
    failureKind?: BenchmarkFailureKind;
  } = {},
): FailedResultInput => {
  const message = err instanceof Error ? err.message : String(err);
  const failureKind = partial.failureKind ?? classifyFailureKind(err);
  return {
    benchmarkId,
    testCaseId: cell.testCase.id,
    promptVersionId: cell.version.id,
    solverModel: cell.solverModel,
    runIndex: cell.runIndex,
    input: cell.testCase.input,
    error: message || `${failureKind} failure`,
    failureKind,
    candidateOutput: partial.candidate?.text ?? "",
    candidateInputTokens: partial.candidate?.usage.inputTokens ?? 0,
    candidateOutputTokens: partial.candidate?.usage.outputTokens ?? 0,
    candidateCostUsd: partial.candidateCostUsd ?? 0,
    judgeInputTokens: partial.judgeInputTokens ?? 0,
    judgeOutputTokens: partial.judgeOutputTokens ?? 0,
    judgeCostUsd: partial.judgeCostUsd ?? 0,
    judgeFailureCount: partial.judgeFailureCount ?? 0,
    latencyMs: partial.latencyMs ?? 0,
  };
};

const classifyFailureKind = (err: unknown): BenchmarkFailureKind => {
  if (err instanceof CellTimeoutError) return "timeout";
  if (err instanceof JudgeExecutionError) return "judge_error";
  if (err instanceof Error) return "unknown";
  return "unknown";
};

const buildPartialJudgeUsage = (
  configuredModel: string,
  err: JudgeExecutionError,
): { inputTokens: number; outputTokens: number; costUsd: number } | null => {
  const usage = err.partial?.usage;
  const model = err.partial?.model ?? configuredModel;
  if (!usage) return null;
  const cost = calculateCost(model, usage.inputTokens, usage.outputTokens);
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd: cost.totalUsd,
  };
};

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;

const estimateCellCostUsd = (
  benchmark: Benchmark,
  totalCells: number,
): number => {
  const forecast = benchmark.costForecast;
  if (!forecast || totalCells <= 0) return 0;
  return forecast.estimatedTotalCostUsd / totalCells;
};

// Slice + shuffle cells so concurrent workers progress across all sample
// points in lockstep (instead of finishing one cell before starting the
// next). Keeps the matrix balanced if the run caps out on budget mid-stream.
const buildSlices = (cells: readonly MatrixCell[], seed: number): CellSlice[] => {
  const bySample = new Map<string, CellSlice>();
  for (const cell of cells) {
    const key = sampleKey(cell);
    const existing = bySample.get(key);
    if (existing) {
      existing.cells.push(cell);
      continue;
    }
    bySample.set(key, {
      sampleKey: key,
      runIndex: cell.runIndex,
      cells: [cell],
    });
  }

  const runBuckets = new Map<number, CellSlice[]>();
  for (const slice of bySample.values()) {
    runBuckets.set(slice.runIndex, [
      ...(runBuckets.get(slice.runIndex) ?? []),
      slice,
    ]);
  }

  return [...runBuckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([runIndex, slices]) =>
      shuffleItems(slices, hashSeed(seed, `run:${runIndex}`)).map((slice) => ({
        ...slice,
        cells: shuffleItems(slice.cells, hashSeed(seed, slice.sampleKey)),
      })),
    );
};

const shuffleItems = <T>(items: readonly T[], seed: number): T[] => {
  const shuffled = [...items];
  let state = seed >>> 0;
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    state = nextShuffleState(state);
    const j = state % (i + 1);
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j] as T;
    shuffled[j] = tmp as T;
  }
  return shuffled;
};

const nextShuffleState = (state: number): number => {
  let x = state >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
};

const hashSeed = (seed: number, value: string): number => {
  let h = seed >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h ^ value.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

// Deterministic 32-bit seed derivation so each (testCase, version, solver,
// runIndex) gets a distinct but reproducible sampling seed.
const deriveSeed = (benchmarkSeed: number, cell: MatrixCell): number => {
  const str = `${cell.testCase.id}|${cell.version.id}|${cell.solverModel}|${cell.runIndex}`;
  let h = benchmarkSeed >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (h ^ str.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h & 0x7fffffff;
};

const deriveJudgeSeed = (
  benchmarkSeed: number,
  cell: MatrixCell,
  judgeModel: string,
): number => {
  const str = `${cell.testCase.id}|${cell.version.id}|${cell.solverModel}|${cell.runIndex}|${judgeModel}`;
  let h = benchmarkSeed >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (h ^ str.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h & 0x7fffffff;
};
