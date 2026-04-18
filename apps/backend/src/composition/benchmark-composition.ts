import { BenchmarkAnalyzer } from "../application/services/benchmark/benchmark-analyzer.js";
import { BenchmarkRunner } from "../application/services/benchmark/benchmark-runner.js";
import { registerBenchmarkJob } from "../application/services/benchmark/benchmark-job.js";
import type { IAIProviderFactory } from "../application/services/ai-provider.js";
import type { IJobQueue } from "../application/services/job-queue.js";
import { CreateBenchmarkUseCase } from "../application/use-cases/benchmarks/create-benchmark.js";
import { GetBenchmarkUseCase } from "../application/use-cases/benchmarks/get-benchmark.js";
import { GetBenchmarkAnalysisUseCase } from "../application/use-cases/benchmarks/get-benchmark-analysis.js";
import { ListBenchmarksUseCase } from "../application/use-cases/benchmarks/list-benchmarks.js";
import { StartBenchmarkUseCase } from "../application/use-cases/benchmarks/start-benchmark.js";
import { UpdateTestCasesUseCase } from "../application/use-cases/benchmarks/update-test-cases.js";
import { MongoBenchmarkRepository } from "../infrastructure/persistence/mongoose/mongo-benchmark-repository.js";
import { MongoBenchmarkResultRepository } from "../infrastructure/persistence/mongoose/mongo-benchmark-result-repository.js";
import { MongoPromptVersionRepository } from "../infrastructure/persistence/mongoose/mongo-prompt-version-repository.js";

export interface BenchmarkComposition {
  createBenchmark: CreateBenchmarkUseCase;
  startBenchmark: StartBenchmarkUseCase;
  listBenchmarks: ListBenchmarksUseCase;
  getBenchmark: GetBenchmarkUseCase;
  getBenchmarkAnalysis: GetBenchmarkAnalysisUseCase;
  updateTestCases: UpdateTestCasesUseCase;
  queue: IJobQueue;
}

export const createBenchmarkComposition = (
  aiFactory: IAIProviderFactory,
  queue: IJobQueue,
): BenchmarkComposition => {
  const benchmarks = new MongoBenchmarkRepository();
  const results = new MongoBenchmarkResultRepository();
  const versions = new MongoPromptVersionRepository();

  const runner = new BenchmarkRunner({
    benchmarks,
    results,
    versions,
    providers: aiFactory,
  });
  registerBenchmarkJob(queue, runner);

  const analyzer = new BenchmarkAnalyzer(aiFactory);

  return {
    createBenchmark: new CreateBenchmarkUseCase(benchmarks, versions, aiFactory),
    startBenchmark: new StartBenchmarkUseCase(benchmarks, queue),
    listBenchmarks: new ListBenchmarksUseCase(benchmarks),
    getBenchmark: new GetBenchmarkUseCase(benchmarks, results),
    getBenchmarkAnalysis: new GetBenchmarkAnalysisUseCase(benchmarks, results, analyzer),
    updateTestCases: new UpdateTestCasesUseCase(benchmarks),
    queue,
  };
};
