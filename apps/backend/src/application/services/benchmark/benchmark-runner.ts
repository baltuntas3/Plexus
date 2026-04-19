import type { Benchmark, BenchmarkTestCase } from "../../../domain/entities/benchmark.js";
import {
  benchmarkResultKey,
  type JudgeVote,
} from "../../../domain/entities/benchmark-result.js";
import type { PromptVersion } from "../../../domain/entities/prompt-version.js";
import {
  NotFoundError,
  ValidationError,
} from "../../../domain/errors/domain-error.js";
import type { IBenchmarkRepository } from "../../../domain/repositories/benchmark-repository.js";
import type {
  IBenchmarkResultRepository,
  UpsertBenchmarkResultInput,
} from "../../../domain/repositories/benchmark-result-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import { JudgeScore } from "../../../domain/value-objects/judge-score.js";
import { mapConcurrent } from "../../utils/map-concurrent.js";
import type { IAIProviderFactory } from "../ai-provider.js";
import type { JobContext } from "../job-queue.js";
import { calculateCost } from "../model-registry.js";
import { LLMJudge } from "../judge/llm-judge.js";
import { JudgeExecutionError, type IJudge } from "../judge/judge.js";
import { computeVerbosityPenaltyAgainstBaseline } from "../judge/verbosity-penalty.js";
import { buildEvaluationPrompt } from "./evaluation-prompt.js";
import type { GenerateResponse } from "../ai-provider.js";

// Orchestrates a single benchmark run end-to-end.
//
// The matrix is (testCase × promptVersion × solverModel × runIndex). Test
// cases are embedded on the Benchmark entity itself — they were generated
// (and optionally annotated with expected outputs) before the benchmark was
// queued. Each logical cell is repeated `bm.repetitions` times so the
// analyzer can estimate within-candidate variance.
//
// Every row is graded by EVERY judge in `bm.judgeModels`; the rubric means
// across judges are stored on the row (judgeAccuracy/Coherence/Instruction),
// and the individual votes are kept on `judgeVotes` for drill-down and
// bias analysis. Judge token cost is the sum across judges.
//
// Per-cell failures do not abort the run: they are captured as "failed" rows
// so a partial matrix is still useful. Only fatal errors (missing versions,
// empty matrix, missing judge models) abort the whole benchmark.
//
// Rows with an `expectedOutput` receive a reference-based verbosity penalty
// inside the judge. Reference-free rows receive a post-run fallback penalty
// against the per-test-case median candidate length, so unusually verbose
// candidates are not silently rewarded when no gold reference exists.
//
// The system prompt for each cell is determined by the PromptVersion: if it
// has a braidGraph, that graph becomes the system prompt; otherwise
// classicalPrompt is used. There is no separate mode field and no benchmark-
// specific instruction prefix is injected.

const DEFAULT_CELL_TIMEOUT_MS = 120_000;
const DEFAULT_BUDGET_USD = 50;
const REFERENCE_FREE_MAX_PENALTY = 0.15;

interface Cell {
  testCase: BenchmarkTestCase;
  version: PromptVersion;
  solverModel: string;
  runIndex: number;
}

export interface BenchmarkRunnerDeps {
  benchmarks: IBenchmarkRepository;
  results: IBenchmarkResultRepository;
  versions: IPromptVersionRepository;
  providers: IAIProviderFactory;
  // Seam for tests — production path instantiates LLMJudge per judge model.
  judgeFactory?: (model: string) => IJudge;
}

export class BenchmarkRunner {
  constructor(private readonly deps: BenchmarkRunnerDeps) {}

  async run(benchmarkId: string, ctx: JobContext): Promise<void> {
    const bm = await this.deps.benchmarks.findById(benchmarkId);
    if (!bm) throw NotFoundError(`Benchmark ${benchmarkId} not found`);

    await this.deps.benchmarks.updateStatus(benchmarkId, {
      status: "running",
      jobId: ctx.jobId,
      startedAt: new Date(),
      error: null,
    });

    try {
      const cells = this.shuffleCells(await this.buildMatrix(bm), bm.seed);
      const existingKeys = await this.deps.results.findExistingKeys(benchmarkId);
      const total = cells.length;
      let completed = 0;
      for (const cell of cells) {
        if (existingKeys.has(cellKey(cell))) completed += 1;
      }

      await this.report(benchmarkId, ctx, completed, total);

      const pending = cells.filter((c) => !existingKeys.has(cellKey(c)));
      const judges = this.buildJudges(bm.judgeModels);
      const cellTimeout = bm.cellTimeoutMs ?? DEFAULT_CELL_TIMEOUT_MS;
      const budget = bm.budgetUsd ?? DEFAULT_BUDGET_USD;
      let spentUsd = 0;

      await mapConcurrent(pending, Math.max(1, bm.concurrency), async (cell) => {
        if (spentUsd >= budget) {
          const row = buildFailedRow(bm.id, cell, new BudgetExceededError(spentUsd, budget));
          await this.deps.results.upsert(row);
          completed += 1;
          await this.report(benchmarkId, ctx, completed, total);
          return;
        }
        const row = await withTimeout(
          this.runCell(bm, cell, judges),
          cellTimeout,
        ).catch((err) => buildFailedRow(bm.id, cell, err));
        spentUsd += row.totalCostUsd;
        await this.deps.results.upsert(row);
        completed += 1;
        await this.report(benchmarkId, ctx, completed, total);
      });

      await this.applyReferenceFreeVerbosityPenalty(benchmarkId, bm);

      await this.deps.benchmarks.updateStatus(benchmarkId, {
        status: "completed",
        completedAt: new Date(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.deps.benchmarks.updateStatus(benchmarkId, {
        status: "failed",
        error: message,
        completedAt: new Date(),
      });
      throw err;
    }
  }

  private async buildMatrix(bm: Benchmark): Promise<Cell[]> {
    if (bm.testCases.length === 0) {
      throw ValidationError("Benchmark has no test cases");
    }
    if (bm.judgeModels.length === 0) {
      throw ValidationError("Benchmark has no judge models");
    }
    if (bm.repetitions < 1) {
      throw ValidationError("Benchmark repetitions must be at least 1");
    }

    const versions = await this.loadVersions(bm.promptVersionIds);

    const cells: Cell[] = [];
    for (const testCase of bm.testCases) {
      for (const version of versions) {
        for (const solverModel of bm.solverModels) {
          for (let runIndex = 0; runIndex < bm.repetitions; runIndex += 1) {
            cells.push({ testCase, version, solverModel, runIndex });
          }
        }
      }
    }

    if (cells.length === 0) {
      throw ValidationError("Benchmark matrix is empty");
    }
    return cells;
  }

  private async loadVersions(ids: readonly string[]): Promise<PromptVersion[]> {
    const found = await Promise.all(
      ids.map((id) => this.deps.versions.findById(id)),
    );
    const missing: string[] = [];
    const versions: PromptVersion[] = [];
    for (let i = 0; i < ids.length; i += 1) {
      const v = found[i];
      if (!v) {
        missing.push(ids[i] as string);
      } else {
        versions.push(v);
      }
    }
    if (missing.length > 0) {
      throw NotFoundError(`PromptVersion(s) not found: ${missing.join(", ")}`);
    }
    return versions;
  }

  private buildJudges(models: readonly string[]): Array<{ model: string; judge: IJudge }> {
    return models.map((model) => ({
      model,
      judge: this.deps.judgeFactory
        ? this.deps.judgeFactory(model)
        : new LLMJudge(this.deps.providers, { judgeModel: model }),
    }));
  }

  private async runCell(
    bm: Benchmark,
    cell: Cell,
    judges: ReadonlyArray<{ model: string; judge: IJudge }>,
  ): Promise<UpsertBenchmarkResultInput> {
    const systemPrompt = buildEvaluationPrompt(cell.version);
    const provider = this.deps.providers.forModel(cell.solverModel);

    const solverSeed = deriveSeed(bm.seed, cell);

    const start = Date.now();
    let candidate: GenerateResponse;
    try {
      candidate = await provider.generate({
        model: cell.solverModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: cell.testCase.input },
        ],
        temperature: bm.solverTemperature,
        seed: solverSeed,
      });
    } catch (err) {
      return buildFailedRow(bm.id, cell, err, {
        latencyMs: Date.now() - start,
      });
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
            seed: deriveJudgeSeed(bm.seed, cell, model),
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
    const votes = judgeExecution.filter((j): j is Extract<typeof judgeExecution[number], { ok: true }> => j.ok);
    const successfulJudgeInputTokens = votes.reduce((sum, vote) => sum + vote.vote.inputTokens, 0);
    const successfulJudgeOutputTokens = votes.reduce((sum, vote) => sum + vote.vote.outputTokens, 0);
    const successfulJudgeCostUsd = votes.reduce((sum, vote) => sum + vote.vote.costUsd, 0);
    if (votes.length === 0) {
      const firstFailure = judgeFailures[0];
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
      return buildFailedRow(
        bm.id,
        cell,
        firstFailure?.err ?? new Error("Judge ensemble incomplete"),
        {
          latencyMs,
          candidate,
          candidateCostUsd: candidateCost.totalUsd,
          judgeInputTokens: successfulJudgeInputTokens + partialJudgeInputTokens,
          judgeOutputTokens: successfulJudgeOutputTokens + partialJudgeOutputTokens,
          judgeCostUsd: successfulJudgeCostUsd + partialJudgeCostUsd,
        },
      );
    }

    const meanAccuracy = mean(votes.map((v) => v.vote.accuracy));
    const meanCoherence = mean(votes.map((v) => v.vote.coherence));
    const meanInstruction = mean(votes.map((v) => v.vote.instruction));
    const meanVerbosityPenalty = mean(votes.map((v) => v.graded.score.verbosityPenalty));
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

    const score = JudgeScore.fromRubric(
      { accuracy: meanAccuracy, coherence: meanCoherence, instruction: meanInstruction },
      meanVerbosityPenalty,
      "",
    );

    const judgeInputTokens =
      successfulJudgeInputTokens + partialJudgeInputTokens;
    const judgeOutputTokens =
      successfulJudgeOutputTokens + partialJudgeOutputTokens;
    const judgeCostUsd =
      successfulJudgeCostUsd + partialJudgeCostUsd;

    return {
      benchmarkId: bm.id,
      testCaseId: cell.testCase.id,
      promptVersionId: cell.version.id,
      solverModel: cell.solverModel,
      runIndex: cell.runIndex,
      input: cell.testCase.input,
      candidateOutput: candidate.text,
      judgeAccuracy: meanAccuracy,
      judgeCoherence: meanCoherence,
      judgeInstruction: meanInstruction,
      judgeVotes: votes.map((v) => v.vote),
      rawScore: score.rawScore,
      verbosityPenalty: meanVerbosityPenalty,
      finalScore: score.finalScore,
      candidateInputTokens: candidate.usage.inputTokens,
      candidateOutputTokens: candidate.usage.outputTokens,
      candidateCostUsd: candidateCost.totalUsd,
      judgeInputTokens,
      judgeOutputTokens,
      judgeCostUsd,
      totalCostUsd: candidateCost.totalUsd + judgeCostUsd,
      latencyMs,
      status: "completed",
      error:
        judgeFailures.length === 0
          ? null
          : `Partial judge failure: ${judgeFailures.length}/${judges.length} judge(s) failed. ${
              judgeFailures
                .map((failure) =>
                  failure.err instanceof Error ? failure.err.message : String(failure.err),
                )
                .join("; ")
            }`,
    };
  }

  private async report(
    benchmarkId: string,
    ctx: JobContext,
    completed: number,
    total: number,
  ): Promise<void> {
    await this.deps.benchmarks.updateProgress(benchmarkId, { completed, total });
    await ctx.reportProgress({ completed, total });
  }

  private async applyReferenceFreeVerbosityPenalty(
    benchmarkId: string,
    bm: Benchmark,
  ): Promise<void> {
    const rows = await this.deps.results.listByBenchmark(benchmarkId);
    const expectedByTestCaseId = new Map(
      bm.testCases.map((testCase) => [testCase.id, testCase.expectedOutput]),
    );
    const lengthsByTestCaseId = new Map<string, number[]>();

    for (const row of rows) {
      if (row.status !== "completed") continue;
      if (expectedByTestCaseId.get(row.testCaseId)) continue;
      const bucket = lengthsByTestCaseId.get(row.testCaseId) ?? [];
      bucket.push(estimateTokenCount(row.candidateOutput));
      lengthsByTestCaseId.set(row.testCaseId, bucket);
    }

    for (const row of rows) {
      if (row.status !== "completed") continue;
      if (expectedByTestCaseId.get(row.testCaseId)) continue;
      const baselineLength = median(lengthsByTestCaseId.get(row.testCaseId) ?? []);
      const verbosityPenalty = computeVerbosityPenaltyAgainstBaseline(
        estimateTokenCount(row.candidateOutput),
        baselineLength,
        REFERENCE_FREE_MAX_PENALTY,
      );
      if (verbosityPenalty === row.verbosityPenalty) continue;
      await this.deps.results.updateScores({
        id: row.id,
        verbosityPenalty,
        finalScore: row.rawScore * (1 - verbosityPenalty),
      });
    }
  }

  private shuffleCells(cells: readonly Cell[], seed: number): Cell[] {
    const shuffled = [...cells];
    let state = seed >>> 0;
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      state = nextShuffleState(state);
      const j = state % (i + 1);
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j] as Cell;
      shuffled[j] = tmp as Cell;
    }
    return shuffled;
  }
}

class BudgetExceededError extends Error {
  constructor(spent: number, budget: number) {
    super(`Budget exceeded: $${spent.toFixed(4)} spent of $${budget.toFixed(2)} limit`);
    this.name = "BudgetExceededError";
  }
}

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Cell timed out after ${ms}ms`)), ms);
      timer.unref?.();
    }),
  ]);
};

const cellKey = (cell: Cell): string =>
  benchmarkResultKey(
    cell.testCase.id,
    cell.version.id,
    cell.solverModel,
    cell.runIndex,
  );

const buildFailedRow = (
  benchmarkId: string,
  cell: Cell,
  err: unknown,
  partial: {
    latencyMs?: number;
    candidate?: GenerateResponse;
    candidateCostUsd?: number;
    judgeInputTokens?: number;
    judgeOutputTokens?: number;
    judgeCostUsd?: number;
  } = {},
): UpsertBenchmarkResultInput => {
  const message = err instanceof Error ? err.message : String(err);
  return {
    benchmarkId,
    testCaseId: cell.testCase.id,
    promptVersionId: cell.version.id,
    solverModel: cell.solverModel,
    runIndex: cell.runIndex,
    input: cell.testCase.input,
    candidateOutput: partial.candidate?.text ?? "",
    judgeAccuracy: 0,
    judgeCoherence: 0,
    judgeInstruction: 0,
    judgeVotes: [],
    rawScore: 0,
    verbosityPenalty: 0,
    finalScore: 0,
    candidateInputTokens: partial.candidate?.usage.inputTokens ?? 0,
    candidateOutputTokens: partial.candidate?.usage.outputTokens ?? 0,
    candidateCostUsd: partial.candidateCostUsd ?? 0,
    judgeInputTokens: partial.judgeInputTokens ?? 0,
    judgeOutputTokens: partial.judgeOutputTokens ?? 0,
    judgeCostUsd: partial.judgeCostUsd ?? 0,
    totalCostUsd: (partial.candidateCostUsd ?? 0) + (partial.judgeCostUsd ?? 0),
    latencyMs: partial.latencyMs ?? 0,
    status: "failed",
    error: message,
  };
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

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
};

const estimateTokenCount = (text: string): number => {
  const matches = text.match(/[\p{L}\p{N}]+(?:['_-][\p{L}\p{N}]+)*|[^\s]/gu);
  return matches?.length ?? 0;
};

const nextShuffleState = (state: number): number => {
  let x = state >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
};

// Deterministic 32-bit seed derivation: a stable fold of the benchmark seed
// and the cell coordinates so each (testCase, version, solver, runIndex)
// gets a distinct but reproducible sampling seed.
const deriveSeed = (benchmarkSeed: number, cell: Cell): number => {
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
  cell: Cell,
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
