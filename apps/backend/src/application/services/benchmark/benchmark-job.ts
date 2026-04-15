import type { IJobQueue, JobHandler } from "../job-queue.js";
import type { BenchmarkRunner } from "./benchmark-runner.js";

export const BENCHMARK_JOB_NAME = "benchmark.run";

export interface BenchmarkJobPayload {
  benchmarkId: string;
}

export const registerBenchmarkJob = (
  queue: IJobQueue,
  runner: BenchmarkRunner,
): void => {
  const handler: JobHandler<BenchmarkJobPayload> = async (payload, ctx) => {
    await runner.run(payload.benchmarkId, ctx);
  };
  queue.register<BenchmarkJobPayload>(BENCHMARK_JOB_NAME, handler);
};
