import type { Benchmark, BenchmarkTestCase } from "../../../domain/entities/benchmark.js";
import { benchmarkResultKey } from "../../../domain/entities/benchmark-result.js";
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
import { mapConcurrent } from "../../utils/map-concurrent.js";
import type { IAIProviderFactory } from "../ai-provider.js";
import type { JobContext } from "../job-queue.js";
import { calculateCost } from "../model-registry.js";
import { LLMJudge } from "../judge/llm-judge.js";
import type { IJudge } from "../judge/judge.js";

// Orchestrates a single benchmark run end-to-end.
//
// The matrix is (testCase × promptVersion × solverModel). Test cases are
// embedded on the Benchmark entity itself — they were generated (and optionally
// annotated with expected outputs) before the benchmark was queued.
//
// Per-cell failures do not abort the run: they are captured as "failed" rows
// so a partial matrix is still useful. Only fatal errors (missing versions,
// empty matrix) abort the whole benchmark.
//
// The system prompt for each cell is determined by the PromptVersion: if it has
// a braidGraph, that graph becomes the system prompt; otherwise classicalPrompt
// is used. There is no separate mode field.

interface Cell {
  testCase: BenchmarkTestCase;
  version: PromptVersion;
  solverModel: string;
}

export interface BenchmarkRunnerDeps {
  benchmarks: IBenchmarkRepository;
  results: IBenchmarkResultRepository;
  versions: IPromptVersionRepository;
  providers: IAIProviderFactory;
  // Seam for tests — production path instantiates LLMJudge with the benchmark's judgeModel.
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
      const cells = await this.buildMatrix(bm);
      const completedKeys = await this.deps.results.findCompletedKeys(benchmarkId);
      const total = cells.length;
      let completed = 0;
      for (const cell of cells) {
        if (completedKeys.has(cellKey(cell))) completed += 1;
      }

      await this.report(benchmarkId, ctx, completed, total);

      const pending = cells.filter((c) => !completedKeys.has(cellKey(c)));
      const judge = this.buildJudge(bm.judgeModel);

      await mapConcurrent(pending, Math.max(1, bm.concurrency), async (cell) => {
        const row = await this.runCell(benchmarkId, cell, judge).catch((err) =>
          buildFailedRow(benchmarkId, cell, err),
        );
        await this.deps.results.upsert(row);
        completed += 1;
        await this.report(benchmarkId, ctx, completed, total);
      });

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

    const versions = await this.loadVersions(bm.promptVersionIds);

    const cells: Cell[] = [];
    for (const testCase of bm.testCases) {
      for (const version of versions) {
        for (const solverModel of bm.solverModels) {
          cells.push({ testCase, version, solverModel });
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

  private buildJudge(model: string): IJudge {
    return this.deps.judgeFactory
      ? this.deps.judgeFactory(model)
      : new LLMJudge(this.deps.providers, { judgeModel: model });
  }

  private async runCell(
    benchmarkId: string,
    cell: Cell,
    judge: IJudge,
  ): Promise<UpsertBenchmarkResultInput> {
    const systemPrompt = buildSystemPrompt(cell.version);
    const provider = this.deps.providers.forModel(cell.solverModel);

    const start = Date.now();
    const candidate = await provider.generate({
      model: cell.solverModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: cell.testCase.input },
      ],
    });
    const latencyMs = Date.now() - start;

    const judged = await judge.grade({
      input: cell.testCase.input,
      candidate: candidate.text,
      reference: cell.testCase.expectedOutput ?? undefined,
    });

    const candidateCost = calculateCost(
      cell.solverModel,
      candidate.usage.inputTokens,
      candidate.usage.outputTokens,
    );
    const judgeCost = calculateCost(
      judged.model,
      judged.usage.inputTokens,
      judged.usage.outputTokens,
    );

    return {
      benchmarkId,
      testCaseId: cell.testCase.id,
      promptVersionId: cell.version.id,
      solverModel: cell.solverModel,
      input: cell.testCase.input,
      candidateOutput: candidate.text,
      judgeAccuracy: judged.score.rubric.accuracy,
      judgeCoherence: judged.score.rubric.coherence,
      judgeInstruction: judged.score.rubric.instruction,
      judgeReasoning: judged.score.reasoning,
      rawScore: judged.score.rawScore,
      verbosityPenalty: judged.score.verbosityPenalty,
      finalScore: judged.score.finalScore,
      candidateInputTokens: candidate.usage.inputTokens,
      candidateOutputTokens: candidate.usage.outputTokens,
      candidateCostUsd: candidateCost.totalUsd,
      judgeInputTokens: judged.usage.inputTokens,
      judgeOutputTokens: judged.usage.outputTokens,
      judgeCostUsd: judgeCost.totalUsd,
      totalCostUsd: candidateCost.totalUsd + judgeCost.totalUsd,
      latencyMs,
      status: "completed",
      error: null,
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
}

const cellKey = (cell: Cell): string =>
  benchmarkResultKey(cell.testCase.id, cell.version.id, cell.solverModel);

// If the version has a BRAID graph, that IS the system prompt. Otherwise fall
// back to the classical prompt text.
const buildSystemPrompt = (version: PromptVersion): string => {
  if (version.braidGraph) {
    return `Follow this BRAID reasoning plan exactly, executing each step in order before producing your answer.\n\n${version.braidGraph}`;
  }
  return version.classicalPrompt;
};

const buildFailedRow = (
  benchmarkId: string,
  cell: Cell,
  err: unknown,
): UpsertBenchmarkResultInput => {
  const message = err instanceof Error ? err.message : String(err);
  return {
    benchmarkId,
    testCaseId: cell.testCase.id,
    promptVersionId: cell.version.id,
    solverModel: cell.solverModel,
    input: cell.testCase.input,
    candidateOutput: "",
    judgeAccuracy: 1,
    judgeCoherence: 1,
    judgeInstruction: 1,
    judgeReasoning: "",
    rawScore: 0,
    verbosityPenalty: 0,
    finalScore: 0,
    candidateInputTokens: 0,
    candidateOutputTokens: 0,
    candidateCostUsd: 0,
    judgeInputTokens: 0,
    judgeOutputTokens: 0,
    judgeCostUsd: 0,
    totalCostUsd: 0,
    latencyMs: 0,
    status: "failed",
    error: message,
  };
};
