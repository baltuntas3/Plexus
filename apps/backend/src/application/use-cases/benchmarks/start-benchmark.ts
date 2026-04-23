import type { IBenchmarkRepository } from "../../../domain/repositories/benchmark-repository.js";
import { ValidationError } from "../../../domain/errors/domain-error.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { IJobQueue } from "../../services/job-queue.js";
import { BENCHMARK_JOB_NAME, type BenchmarkJobPayload } from "../../services/benchmark/benchmark-job.js";
import { estimateBenchmarkCost } from "./create-benchmark.js";
import { ensureBenchmarkAccess } from "./ensure-benchmark-access.js";

export interface StartBenchmarkCommand {
  benchmarkId: string;
  ownerId: string;
}

export interface StartBenchmarkResult {
  benchmarkId: string;
  jobId: string;
}

// Enqueues a run for an already-created benchmark. Separate from create so
// that the client can create → review → start without an implicit side effect.
// Safe to call on a failed/completed benchmark to re-run remaining cells
// (the runner is idempotent on already-completed cells).

export class StartBenchmarkUseCase {
  constructor(
    private readonly benchmarks: IBenchmarkRepository,
    private readonly versions: IPromptVersionRepository,
    private readonly queue: IJobQueue,
  ) {}

  async execute(command: StartBenchmarkCommand): Promise<StartBenchmarkResult> {
    const bm = await ensureBenchmarkAccess(
      this.benchmarks,
      command.benchmarkId,
      command.ownerId,
    );
    if (bm.status === "running") {
      throw ValidationError("Benchmark is already running");
    }
    if (bm.status === "queued") {
      throw ValidationError("Benchmark is already queued");
    }
    const versions = await Promise.all(
      bm.promptVersionIds.map((id) => this.versions.findById(id)),
    );
    const missing = bm.promptVersionIds.filter((_, index) => !versions[index]);
    if (missing.length > 0) {
      throw ValidationError(`PromptVersion(s) not found: ${missing.join(", ")}`);
    }
    const costForecast = estimateBenchmarkCost({
      versions: versions as NonNullable<(typeof versions)[number]>[],
      generatedInputs: bm.testCases.map((testCase) => testCase.input),
      solverModels: bm.solverModels,
      judgeModels: bm.judgeModels,
      repetitions: bm.repetitions,
    });
    await this.benchmarks.updateCostForecast(bm.id, costForecast);
    if (costForecast.estimatedTotalCostUsd > (bm.budgetUsd ?? 50)) {
      throw ValidationError(
        `Estimated benchmark cost $${costForecast.estimatedTotalCostUsd.toFixed(4)} exceeds the $${(bm.budgetUsd ?? 50).toFixed(2)} cap. Reduce test count, solver count, or repetitions.`,
      );
    }

    const payload: BenchmarkJobPayload = { benchmarkId: bm.id };
    const jobId = await this.queue.enqueue<BenchmarkJobPayload>(BENCHMARK_JOB_NAME, payload);
    return { benchmarkId: bm.id, jobId };
  }
}
