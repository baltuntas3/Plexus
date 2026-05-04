import type { IBenchmarkRepository } from "../../../domain/repositories/benchmark-repository.js";
import { ValidationError } from "../../../domain/errors/domain-error.js";
import type { IPromptQueryService } from "../../queries/prompt-query-service.js";
import type { IJobQueue } from "../../services/job-queue.js";
import {
  BENCHMARK_JOB_NAME,
  type BenchmarkJobPayload,
} from "../../services/benchmark/benchmark-job.js";
import {
  BenchmarkCostEstimator,
  DEFAULT_BUDGET_USD,
  averageTokenCount,
} from "../../services/benchmark/benchmark-cost-estimator.js";
import { ensureBenchmarkAccess } from "./ensure-benchmark-access.js";

export interface StartBenchmarkCommand {
  benchmarkId: string;
  organizationId: string;
}

export interface StartBenchmarkResult {
  benchmarkId: string;
  jobId: string;
}

// Enqueues a run for an already-created benchmark. Separate from create so
// the client can create → review → start without an implicit side effect.
// Safe to call on a failed/completed benchmark to re-run remaining cells —
// the aggregate's state machine rejects only "already queued" / "already
// running" transitions. The runner is idempotent on already-completed cells.

export class StartBenchmarkUseCase {
  private readonly costEstimator = new BenchmarkCostEstimator();

  constructor(
    private readonly benchmarks: IBenchmarkRepository,
    private readonly promptQueries: IPromptQueryService,
    private readonly queue: IJobQueue,
  ) {}

  async execute(command: StartBenchmarkCommand): Promise<StartBenchmarkResult> {
    const benchmark = await ensureBenchmarkAccess(
      this.benchmarks,
      command.benchmarkId,
      command.organizationId,
    );
    const versionsById = await this.promptQueries.findVersionSummariesByIdsInOrganization(
      benchmark.promptVersionIds,
      benchmark.organizationId,
    );
    const missing = benchmark.promptVersionIds.filter(
      (id) => !versionsById.has(id),
    );
    if (missing.length > 0) {
      throw ValidationError(`PromptVersion(s) not found: ${missing.join(", ")}`);
    }
    const versions = benchmark.promptVersionIds.map((id) => versionsById.get(id)!);
    const inputs = benchmark.testCases.map((testCase) => testCase.input);
    const costForecast = this.costEstimator.estimate({
      versions,
      testCount: inputs.length,
      avgInputTokens: averageTokenCount(inputs),
      solverModels: benchmark.solverModels,
      judgeModels: benchmark.judgeModels,
      repetitions: benchmark.repetitions,
    });
    benchmark.refreshCostForecast(costForecast);
    const budget = benchmark.budgetUsd ?? DEFAULT_BUDGET_USD;
    if (costForecast.estimatedTotalCostUsd > budget) {
      throw ValidationError(
        `Estimated benchmark cost $${costForecast.estimatedTotalCostUsd.toFixed(4)} exceeds the $${budget.toFixed(2)} cap. Reduce test count, solver count, or repetitions.`,
      );
    }

    // `queue()` enforces "not already queued / running" at the domain level;
    // the use case no longer duplicates those status checks.
    benchmark.queue();
    await this.benchmarks.save(benchmark);

    // If enqueue fails after the queued state was persisted the benchmark
    // would otherwise sit in "queued" forever — `queue()` rejects re-entry,
    // so the user has no recovery path. Recording a failure releases the
    // aggregate back to a re-runnable terminal state.
    const payload: BenchmarkJobPayload = { benchmarkId: benchmark.id };
    let jobId: string;
    try {
      jobId = await this.queue.enqueue<BenchmarkJobPayload>(
        BENCHMARK_JOB_NAME,
        payload,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      benchmark.failWith(`Failed to enqueue benchmark job: ${message}`);
      await this.benchmarks.save(benchmark);
      throw err;
    }
    return { benchmarkId: benchmark.id, jobId };
  }
}
