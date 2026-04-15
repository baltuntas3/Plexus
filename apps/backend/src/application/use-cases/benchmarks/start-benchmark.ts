import type { IBenchmarkRepository } from "../../../domain/repositories/benchmark-repository.js";
import { ValidationError } from "../../../domain/errors/domain-error.js";
import type { IJobQueue } from "../../services/job-queue.js";
import { BENCHMARK_JOB_NAME, type BenchmarkJobPayload } from "../../services/benchmark/benchmark-job.js";
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

    const payload: BenchmarkJobPayload = { benchmarkId: bm.id };
    const jobId = await this.queue.enqueue<BenchmarkJobPayload>(BENCHMARK_JOB_NAME, payload);
    return { benchmarkId: bm.id, jobId };
  }
}
