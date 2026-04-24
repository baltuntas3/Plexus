import { BenchmarkAnalyzer } from "../application/services/benchmark/benchmark-analyzer.js";
import { BenchmarkRunner } from "../application/services/benchmark/benchmark-runner.js";
import { registerBenchmarkJob } from "../application/services/benchmark/benchmark-job.js";
import type { IAIProviderFactory } from "../application/services/ai-provider.js";
import type { IJobQueue } from "../application/services/job-queue.js";
import type { IPromptQueryService } from "../application/queries/prompt-query-service.js";
import type { IIdGenerator } from "../domain/services/id-generator.js";
import { CreateBenchmarkUseCase } from "../application/use-cases/benchmarks/create-benchmark.js";
import { GetBenchmarkUseCase } from "../application/use-cases/benchmarks/get-benchmark.js";
import { GetBenchmarkAnalysisUseCase } from "../application/use-cases/benchmarks/get-benchmark-analysis.js";
import { ListBenchmarksUseCase } from "../application/use-cases/benchmarks/list-benchmarks.js";
import { StartBenchmarkUseCase } from "../application/use-cases/benchmarks/start-benchmark.js";
import { UpdateTestCasesUseCase } from "../application/use-cases/benchmarks/update-test-cases.js";
import { MongoBenchmarkRepository } from "../infrastructure/persistence/mongoose/mongo-benchmark-repository.js";
import { MongoBenchmarkResultRepository } from "../infrastructure/persistence/mongoose/mongo-benchmark-result-repository.js";
import { MongoBenchmarkQueryService } from "../infrastructure/persistence/mongoose/mongo-benchmark-query-service.js";
import { MongoObjectIdGenerator } from "../infrastructure/persistence/mongoose/object-id-generator.js";

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
  promptQueries: IPromptQueryService,
): BenchmarkComposition => {
  const benchmarks = new MongoBenchmarkRepository();
  const results = new MongoBenchmarkResultRepository();
  const queries = new MongoBenchmarkQueryService();
  const idGenerator: IIdGenerator = new MongoObjectIdGenerator();

  const runner = new BenchmarkRunner({
    benchmarks,
    results,
    promptQueries,
    providers: aiFactory,
  });
  registerBenchmarkJob(queue, runner);

  const analyzer = new BenchmarkAnalyzer(aiFactory);

  return {
    createBenchmark: new CreateBenchmarkUseCase(
      benchmarks,
      promptQueries,
      aiFactory,
      idGenerator,
    ),
    startBenchmark: new StartBenchmarkUseCase(benchmarks, promptQueries, queue),
    listBenchmarks: new ListBenchmarksUseCase(queries),
    getBenchmark: new GetBenchmarkUseCase(benchmarks, results, promptQueries),
    getBenchmarkAnalysis: new GetBenchmarkAnalysisUseCase(
      benchmarks,
      results,
      promptQueries,
      analyzer,
    ),
    updateTestCases: new UpdateTestCasesUseCase(
      benchmarks,
      promptQueries,
      idGenerator,
    ),
    queue,
  };
};
