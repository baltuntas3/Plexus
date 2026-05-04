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
import { buildBenchmarkMatrix, type MatrixCell } from "../../../domain/value-objects/benchmark-matrix.js";
import type { IBenchmarkRepository } from "../../../domain/repositories/benchmark-repository.js";
import type { IBenchmarkResultRepository } from "../../../domain/repositories/benchmark-result-repository.js";
import type { IPromptQueryService } from "../../queries/prompt-query-service.js";
import { fnv1a } from "../../utils/fnv1a.js";
import { mapConcurrent } from "../../utils/map-concurrent.js";
import { seededShuffle } from "../../utils/seeded-shuffle.js";
import type { IAIProviderFactory, GenerateResponse } from "../ai-provider.js";
import type { JobContext } from "../job-queue.js";
import { calculateCost } from "../model-registry.js";
import { DEFAULT_BUDGET_USD } from "./benchmark-cost-estimator.js";
import { LLMJudge } from "../judge/llm-judge.js";
import {
  JudgeExecutionError,
  type BatchJudgeResult,
  type IJudge,
} from "../judge/judge.js";
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
// Execution unit is a "triple" — (testCase × version × solver) with all of
// its repetitions. Solver calls inside a triple run in parallel (one per
// rep) and produce N candidates that are then graded by a SINGLE batched
// judge call per judge model. Batching reps inside a triple is fairness-
// neutral because all candidates come from the same prompt × input — the
// judge scores them independently with anonymous shuffled labels — and
// cuts judge LLM calls by ~repetitions×.
//
// Every row is graded by every judge in `benchmark.judgeModels`; rubric
// means are stored on the row, individual votes on `judgeVotes` for
// drill-down and bias analysis. Per-cell failures are captured as "failed"
// rows so a partial matrix is still useful.

const DEFAULT_CELL_TIMEOUT_MS = 120_000;
// Solver temperature is server-fixed (not a user knob) so two benchmarks of
// the same prompts/models stay directly comparable. The value is non-zero
// on purpose: Plexus measures real production behaviour, where users sample
// from the model rather than pin it to greedy decoding. With T=0 every
// repetition would collapse to the same output and the entire uncertainty
// stack — repetitions, consistencyScore, ci95, paired-difference
// significance, suggestedRepetitions — would degenerate to "no information
// per cell". 0.7 matches the default real callers actually use and keeps
// repetitions doing what they're for: capturing sampling variance.
const SOLVER_TEMPERATURE = 0.7;

// Within-triple solver fan-out cap. A triple holds `repetitions` cells
// (same testCase × version × solver, different runIndex). Without a
// bound, `repetitions=10` would fire 10 simultaneous solver calls inside
// each in-flight triple, multiplying with the outer triple-level
// concurrency to easily blow per-model TPM caps. Two keeps the cells
// pipelined enough to amortize provider latency without saturating the
// rate-limit window.
const INNER_SOLVER_CONCURRENCY = 2;

interface Triple {
  testCaseId: string;
  versionId: string;
  solverModel: string;
  // Cells in runIndex order so persisted rows for the same triple are
  // ordered consistently across resumes.
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
      const cells = buildBenchmarkMatrix({
        testCases: benchmark.testCases,
        versions,
        solverModels: [...benchmark.solverModels],
        repetitions: benchmark.repetitions,
      });
      const estimatedCellCostUsd = estimateCellCostUsd(benchmark, cells.length);
      const existingRows = await this.deps.results.listByBenchmark(benchmarkId);
      const existingByKey = new Map(
        existingRows.map((row) => [rowKey(row), row] as const),
      );
      const total = cells.length;
      let processed = cells.reduce((sum, cell) => {
        const row = existingByKey.get(cellKey(cell));
        return sum + (row?.status === "completed" ? 1 : 0);
      }, 0);

      benchmark.recordProgress(processed, total);
      await this.deps.benchmarks.save(benchmark);
      await ctx.reportProgress({ completed: processed, total });

      const triples = buildTriples(cells).flatMap((triple) => {
        const pending = triple.cells.filter(
          (cell) => existingByKey.get(cellKey(cell))?.status !== "completed",
        );
        if (pending.length === 0) return [];
        return [{ ...triple, cells: pending }];
      });
      const judges = this.buildJudges(benchmark.judgeModels, benchmark.taskType);
      const cellTimeout = benchmark.cellTimeoutMs ?? DEFAULT_CELL_TIMEOUT_MS;
      const budget = benchmark.budgetUsd ?? DEFAULT_BUDGET_USD;
      let spentUsd = existingRows.reduce(
        (sum, row) => sum + row.totalCostUsd,
        0,
      );
      // Only completed rows feed the per-cell reserve estimate. Failed rows
      // commonly carry zero or partial cost (early solver errors, judge
      // failures before the second LLM round-trip), so including them
      // systematically underestimates the cost of the *next* cell — which
      // makes the runner overshoot `budgetUsd` when failure rates are high.
      let observedCellCosts = existingRows.reduce(
        (sum, row) => (row.status === "completed" ? sum + row.totalCostUsd : sum),
        0,
      );
      let observedCellCount = existingRows.reduce(
        (count, row) => (row.status === "completed" ? count + 1 : count),
        0,
      );
      let cappedByBudget = false;

      const reservePerCellUsd = (): number =>
        observedCellCount > 0
          ? observedCellCosts / observedCellCount
          : estimatedCellCostUsd;

      // Group triples into version-balance buckets per testCase so a budget
      // cap leaves balanced version coverage at a triple boundary.
      const tripleBuckets = bucketByTestCase(triples, benchmark.seed);
      for (const bucket of tripleBuckets) {
        const estimatedBucketCostUsd =
          reservePerCellUsd() *
          bucket.reduce((sum, t) => sum + t.cells.length, 0);
        if (spentUsd + estimatedBucketCostUsd > budget) {
          cappedByBudget = true;
          break;
        }
        await mapConcurrent(
          bucket,
          Math.max(1, benchmark.concurrency),
          async (triple) => {
            const tripleTimeout = cellTimeout * Math.max(1, triple.cells.length);
            const rows = await withTimeout(
              this.runTriple(benchmark!, triple, judges),
              tripleTimeout,
            ).catch((err): UpsertableBenchmarkResult[] =>
              triple.cells.map((cell) =>
                failedBenchmarkResult({
                  benchmarkId: benchmark!.id,
                  testCaseId: cell.testCase.id,
                  promptVersionId: cell.version.id,
                  solverModel: cell.solverModel,
                  runIndex: cell.runIndex,
                  error: err instanceof Error ? err.message : String(err),
                  failureKind: classifyFailureKind(err),
                }),
              ),
            );
            for (const row of rows) {
              spentUsd += row.totalCostUsd;
              if (row.status === "completed") {
                observedCellCosts += row.totalCostUsd;
                observedCellCount += 1;
              }
              await this.deps.results.upsert(row);
              processed += 1;
            }
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
      if (
        latest &&
        latest.status !== "completed" &&
        latest.status !== "completed_with_budget_cap" &&
        latest.status !== "failed"
      ) {
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

  private async runTriple(
    benchmark: Benchmark,
    triple: Triple,
    judges: ReadonlyArray<{ model: string; judge: IJudge }>,
  ): Promise<UpsertableBenchmarkResult[]> {
    const firstCell = triple.cells[0] as MatrixCell;
    const systemPrompt = buildEvaluationPrompt(firstCell.version);
    const provider = this.deps.providers.forModel(triple.solverModel);

    // Solver phase — one call per rep. Failures are captured as per-rep
    // failed rows; successful candidates feed the batched judge phase.
    // Bounded by `INNER_SOLVER_CONCURRENCY` so a high-repetition triple
    // does not fan out its reps simultaneously and trip per-model TPM
    // caps when stacked with the outer triple-level concurrency.
    interface SolverOutcome {
      cell: MatrixCell;
      candidate: GenerateResponse | null;
      candidateCostUsd: number;
      latencyMs: number;
      error: unknown | null;
    }
    const solverOutcomes: SolverOutcome[] = await mapConcurrent(
      triple.cells,
      INNER_SOLVER_CONCURRENCY,
      async (cell) => {
        const solverSeed = deriveSolverSeed(benchmark.seed, cell);
        const start = Date.now();
        try {
          const candidate = await provider.generate({
            model: cell.solverModel,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: cell.testCase.input },
            ],
            temperature: SOLVER_TEMPERATURE,
            seed: solverSeed,
          });
          const cost = calculateCost(
            cell.solverModel,
            candidate.usage.inputTokens,
            candidate.usage.outputTokens,
          );
          return {
            cell,
            candidate,
            candidateCostUsd: cost.totalUsd,
            latencyMs: Date.now() - start,
            error: null,
          };
        } catch (err) {
          return {
            cell,
            candidate: null,
            candidateCostUsd: 0,
            latencyMs: Date.now() - start,
            error: err,
          };
        }
      },
    );

    const successful = solverOutcomes.filter(
      (o): o is SolverOutcome & { candidate: GenerateResponse } => o.candidate !== null,
    );

    const failedRows = solverOutcomes
      .filter((o) => o.candidate === null)
      .map((o) =>
        failedBenchmarkResult(
          buildFailedInput(benchmark.id, o.cell, o.error, {
            latencyMs: o.latencyMs,
            failureKind: "solver_error",
          }),
        ),
      );

    if (successful.length === 0) {
      return failedRows;
    }

    // Judge phase — one batched call per judge model, scoring all
    // successful candidates of THIS triple in a single LLM round-trip.
    // Sequential across judges (not Promise.all): the outer triple-level
    // concurrency already runs multiple triples in parallel, and judges
    // typically share the same provider with the solver, so fanning out
    // ensemble calls within a single triple multiplies per-model TPM
    // pressure for no real wall-clock win — each judge call is its own
    // round-trip and the next judge can start the moment this one returns.
    interface JudgeOutcome {
      model: string;
      // Per-candidate vote, aligned with `successful` order.
      votes: Array<JudgeVote | null>;
      partial: { inputTokens: number; outputTokens: number; costUsd: number } | null;
      error: unknown | null;
    }

    const judgeOutcomes: JudgeOutcome[] = [];
    for (const { model, judge } of judges) {
      try {
        const graded: BatchJudgeResult = await judge.gradeBatch({
          input: firstCell.testCase.input,
          candidates: successful.map((s) => s.candidate.text),
          seed: deriveBatchJudgeSeed(benchmark.seed, triple, model),
          reference: firstCell.testCase.expectedOutput ?? undefined,
          systemPrompt,
        });
        // Equal usage attribution across the batched candidates — the
        // judge prompt is shared, so per-candidate "true" cost is not
        // recoverable. Equal split keeps PPD honest by giving each row
        // an identical denominator contribution.
        const n = successful.length;
        const inputPer = Math.floor(graded.usage.inputTokens / n);
        const outputPer = Math.floor(graded.usage.outputTokens / n);
        const perCellCost = calculateCost(graded.model, inputPer, outputPer);
        const votes: JudgeVote[] = graded.scores.map((score) => ({
          model,
          accuracy: score.rubric.accuracy,
          coherence: score.rubric.coherence,
          instruction: score.rubric.instruction,
          reasoning: score.reasoning,
          inputTokens: inputPer,
          outputTokens: outputPer,
          costUsd: perCellCost.totalUsd,
        }));
        judgeOutcomes.push({ model, votes, partial: null, error: null });
      } catch (err) {
        // Extract partial usage from a JudgeExecutionError (if any) and
        // distribute it equally across attempted candidates so per-row
        // token/cost reflects what was actually spent before the failure.
        let perCellPartial:
          | { inputTokens: number; outputTokens: number; costUsd: number }
          | null = null;
        if (err instanceof JudgeExecutionError && err.partial?.usage) {
          const usage = err.partial.usage;
          const judgeModel = err.partial.model ?? model;
          const cost = calculateCost(
            judgeModel,
            usage.inputTokens,
            usage.outputTokens,
          );
          const count = successful.length;
          if (count > 0) {
            perCellPartial = {
              inputTokens: Math.floor(usage.inputTokens / count),
              outputTokens: Math.floor(usage.outputTokens / count),
              costUsd: cost.totalUsd / count,
            };
          }
        }
        judgeOutcomes.push({
          model,
          votes: successful.map(() => null),
          partial: perCellPartial,
          error: err,
        });
      }
    }

    // Stitch per-cell rows from solver outcome + per-judge votes.
    const successfulRows: UpsertableBenchmarkResult[] = successful.map(
      (outcome, candidateIndex) => {
        const cell = outcome.cell;
        const votesForCell = judgeOutcomes
          .map((judge) => judge.votes[candidateIndex])
          .filter((vote): vote is JudgeVote => vote !== null);
        const judgeFailuresForCell = judgeOutcomes.filter(
          (judge) => judge.votes[candidateIndex] === null,
        );

        const successfulJudgeInputTokens = votesForCell.reduce(
          (sum, vote) => sum + vote.inputTokens,
          0,
        );
        const successfulJudgeOutputTokens = votesForCell.reduce(
          (sum, vote) => sum + vote.outputTokens,
          0,
        );
        const successfulJudgeCostUsd = votesForCell.reduce(
          (sum, vote) => sum + vote.costUsd,
          0,
        );
        const partialJudgeInputTokens = judgeFailuresForCell.reduce(
          (sum, judge) => sum + (judge.partial?.inputTokens ?? 0),
          0,
        );
        const partialJudgeOutputTokens = judgeFailuresForCell.reduce(
          (sum, judge) => sum + (judge.partial?.outputTokens ?? 0),
          0,
        );
        const partialJudgeCostUsd = judgeFailuresForCell.reduce(
          (sum, judge) => sum + (judge.partial?.costUsd ?? 0),
          0,
        );
        const judgeInputTokens =
          successfulJudgeInputTokens + partialJudgeInputTokens;
        const judgeOutputTokens =
          successfulJudgeOutputTokens + partialJudgeOutputTokens;
        const judgeCostUsd = successfulJudgeCostUsd + partialJudgeCostUsd;

        if (votesForCell.length === 0) {
          const firstFailure = judgeFailuresForCell[0];
          return failedBenchmarkResult(
            buildFailedInput(
              benchmark.id,
              cell,
              firstFailure?.error ?? new Error("Judge ensemble incomplete"),
              {
                latencyMs: outcome.latencyMs,
                candidate: outcome.candidate,
                candidateCostUsd: outcome.candidateCostUsd,
                judgeInputTokens,
                judgeOutputTokens,
                judgeCostUsd,
                failureKind: "judge_error",
              },
            ),
          );
        }

        const completed: CompletedResultInput = {
          benchmarkId: benchmark.id,
          testCaseId: cell.testCase.id,
          promptVersionId: cell.version.id,
          solverModel: cell.solverModel,
          runIndex: cell.runIndex,
          candidateOutput: outcome.candidate.text,
          candidateInputTokens: outcome.candidate.usage.inputTokens,
          candidateOutputTokens: outcome.candidate.usage.outputTokens,
          candidateCostUsd: outcome.candidateCostUsd,
          judgeVotes: votesForCell,
          judgeInputTokens,
          judgeOutputTokens,
          judgeCostUsd,
          judgeFailureCount: judgeFailuresForCell.length,
          latencyMs: outcome.latencyMs,
          partialJudgeFailureMessage:
            judgeFailuresForCell.length === 0
              ? null
              : `Partial judge failure: ${judgeFailuresForCell.length}/${judges.length} judge(s) failed. ${judgeFailuresForCell
                  .map((judge) =>
                    judge.error instanceof Error
                      ? judge.error.message
                      : String(judge.error),
                  )
                  .join("; ")}`,
        };
        return completedBenchmarkResult(completed);
      },
    );

    return [...failedRows, ...successfulRows];
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

const tripleKey = (cell: MatrixCell): string =>
  `${cell.testCase.id}::${cell.version.id}::${cell.solverModel}`;

const rowKey = (
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

const estimateCellCostUsd = (
  benchmark: Benchmark,
  totalCells: number,
): number => {
  const forecast = benchmark.costForecast;
  if (!forecast || totalCells <= 0) return 0;
  return forecast.estimatedTotalCostUsd / totalCells;
};

// Build (testCase × version × solver) triples from the matrix; each triple
// holds all repetitions of a single cell so we can issue one batched judge
// call per judge model. Triple emission order follows matrix order, which
// the matrix builder already keeps stable across runs.
const buildTriples = (cells: readonly MatrixCell[]): Triple[] => {
  const byKey = new Map<string, Triple>();
  for (const cell of cells) {
    const key = tripleKey(cell);
    const existing = byKey.get(key);
    if (existing) {
      existing.cells.push(cell);
      continue;
    }
    byKey.set(key, {
      testCaseId: cell.testCase.id,
      versionId: cell.version.id,
      solverModel: cell.solverModel,
      cells: [cell],
    });
  }
  for (const triple of byKey.values()) {
    triple.cells.sort((a, b) => a.runIndex - b.runIndex);
  }
  return [...byKey.values()];
};

// Group triples by testCase, then seed-shuffle both the (version, solver)
// triples inside each bucket and the bucket order itself. Budget caps stop
// at a bucket boundary, so completed testCases retain full version × solver
// coverage; the shuffle prevents matrix-order from systematically privileging
// the same testCases / triples whenever a benchmark hits its budget cap.
// The shuffle is deterministic in `benchmarkSeed` so reruns are reproducible.
const bucketByTestCase = (
  triples: readonly Triple[],
  benchmarkSeed: number,
): Triple[][] => {
  const byTestCase = new Map<string, Triple[]>();
  for (const triple of triples) {
    const list = byTestCase.get(triple.testCaseId) ?? [];
    list.push(triple);
    byTestCase.set(triple.testCaseId, list);
  }
  // Distinct seeds per axis so within-bucket and cross-bucket permutations
  // are independent — using the same seed for both would correlate them.
  const innerSeed = fnvSeed(benchmarkSeed, "bucket:inner");
  const outerSeed = fnvSeed(benchmarkSeed, "bucket:outer");
  const shuffledBuckets = [...byTestCase.values()].map((bucket) =>
    seededShuffle(bucket, innerSeed),
  );
  return seededShuffle(shuffledBuckets, outerSeed);
};

// Mask to 31 bits so derived seeds satisfy the BenchmarkSeed contract
// ([0, 2^31)) — that's the same range the runner's downstream PRNG callers
// expect. Domain choices:
//   - solver path passes the cell coordinates so each rep gets a distinct
//     sampling seed.
//   - batch-judge path passes (triple, judgeModel) so the judge sees a
//     deterministic label permutation that is fixed across the triple's
//     reps but distinct per (triple, judgeModel).
const fnvSeed = (benchmarkSeed: number, str: string): number =>
  fnv1a(benchmarkSeed, str) & 0x7fffffff;

const deriveSolverSeed = (benchmarkSeed: number, cell: MatrixCell): number =>
  fnvSeed(
    benchmarkSeed,
    `${cell.testCase.id}|${cell.version.id}|${cell.solverModel}|${cell.runIndex}`,
  );

const deriveBatchJudgeSeed = (
  benchmarkSeed: number,
  triple: Triple,
  judgeModel: string,
): number =>
  fnvSeed(
    benchmarkSeed,
    `${triple.testCaseId}|${triple.versionId}|${triple.solverModel}|${judgeModel}`,
  );
