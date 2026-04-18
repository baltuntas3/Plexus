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
// inside the judge. Reference-free completed rows are rewritten in a post-run
// pass using a per-test-case median completed candidate length as the
// baseline so unrelated tasks do not distort one another's verbosity target.
//
// The system prompt for each cell is determined by the PromptVersion: if it
// has a braidGraph, that graph becomes the system prompt; otherwise
// classicalPrompt is used. There is no separate mode field and no benchmark-
// specific instruction prefix is injected.

const SOLVER_TEMPERATURE = 0.7;

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
      const completedKeys = await this.deps.results.findCompletedKeys(benchmarkId);
      const total = cells.length;
      let completed = 0;
      for (const cell of cells) {
        if (completedKeys.has(cellKey(cell))) completed += 1;
      }

      await this.report(benchmarkId, ctx, completed, total);

      const pending = cells.filter((c) => !completedKeys.has(cellKey(c)));
      const judges = this.buildJudges(bm.judgeModels);

      await mapConcurrent(pending, Math.max(1, bm.concurrency), async (cell) => {
        const row = await this.runCell(bm, cell, judges).catch((err) =>
          buildFailedRow(bm.id, cell, err),
        );
        await this.deps.results.upsert(row);
        completed += 1;
        await this.report(benchmarkId, ctx, completed, total);
      });

      await this.applyReferenceFreeVerbosityPass(bm);

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
        temperature: SOLVER_TEMPERATURE,
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
      return buildFailedRow(bm.id, cell, firstFailure?.err ?? new Error("Judge failed"), {
        latencyMs,
        candidate,
        candidateCostUsd: candidateCost.totalUsd,
        judgeInputTokens: partialJudgeInputTokens,
        judgeOutputTokens: partialJudgeOutputTokens,
        judgeCostUsd: partialJudgeCostUsd,
      });
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
      votes.reduce((s, v) => s + v.vote.inputTokens, 0) + partialJudgeInputTokens;
    const judgeOutputTokens =
      votes.reduce((s, v) => s + v.vote.outputTokens, 0) + partialJudgeOutputTokens;
    const judgeCostUsd =
      votes.reduce((s, v) => s + v.vote.costUsd, 0) + partialJudgeCostUsd;

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

  private async applyReferenceFreeVerbosityPass(bm: Benchmark): Promise<void> {
    const rows = await this.deps.results.listByBenchmark(bm.id);
    const completedRows = rows.filter(isCompletedRow);
    const testCasesById = new Map(bm.testCases.map((testCase) => [testCase.id, testCase]));
    const baselineLengthByTestCase = new Map<string, number>();
    for (const [testCaseId, testCase] of testCasesById) {
      if (testCase?.expectedOutput) continue;
      const lengths = completedRows
        .filter((row) => row.testCaseId === testCaseId)
        .map(candidateLength)
        .filter((length) => length > 0)
        .sort((a, b) => a - b);
      const baselineLength = median(lengths);
      if (baselineLength > 0) {
        baselineLengthByTestCase.set(testCaseId, baselineLength);
      }
    }

    if (baselineLengthByTestCase.size === 0) return;

    await Promise.all(
      completedRows
        .filter((row) => shouldApplyReferenceFreeVerbosityPenalty(row, testCasesById))
        .map((row) => {
          const baselineLength = baselineLengthByTestCase.get(row.testCaseId) ?? 0;
          const verbosityPenalty = computeVerbosityPenaltyAgainstBaseline(
            candidateLength(row),
            baselineLength,
          );
          return this.deps.results.updateScores({
            id: row.id,
            verbosityPenalty,
            finalScore: row.rawScore * (1 - verbosityPenalty),
          });
        }),
    );
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
    judgeAccuracy: 1,
    judgeCoherence: 1,
    judgeInstruction: 1,
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

const isCompletedRow = (
  row: UpsertBenchmarkResultInput | import("../../../domain/entities/benchmark-result.js").BenchmarkResult,
): boolean => row.status === "completed";

const candidateLength = (
  row: Pick<UpsertBenchmarkResultInput, "candidateOutput">,
): number => row.candidateOutput.length;

const shouldApplyReferenceFreeVerbosityPenalty = (
  row: Pick<UpsertBenchmarkResultInput, "testCaseId">,
  testCasesById: ReadonlyMap<string, BenchmarkTestCase>,
): boolean => !testCasesById.get(row.testCaseId)?.expectedOutput;

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const mid = Math.floor(values.length / 2);
  if (values.length % 2 === 1) {
    return values[mid] ?? 0;
  }
  return ((values[mid - 1] ?? 0) + (values[mid] ?? 0)) / 2;
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
