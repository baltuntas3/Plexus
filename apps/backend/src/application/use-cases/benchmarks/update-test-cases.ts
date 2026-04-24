import type { BenchmarkTestCase } from "../../../domain/entities/benchmark.js";
import type { IBenchmarkRepository } from "../../../domain/repositories/benchmark-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import type { IPromptQueryService } from "../../queries/prompt-query-service.js";
import { ValidationError } from "../../../domain/errors/domain-error.js";
import { BenchmarkCostEstimator } from "../../services/benchmark/benchmark-cost-estimator.js";
import { ensureBenchmarkAccess } from "./ensure-benchmark-access.js";

export interface UpdateTestCasesCommand {
  benchmarkId: string;
  ownerId: string;
  updates: Array<{
    id: string;
    input?: string;
    expectedOutput: string | null;
    category?: BenchmarkTestCase["category"];
  }>;
  additions: Array<{
    input: string;
    expectedOutput: string | null;
    category?: BenchmarkTestCase["category"];
  }>;
}

// Allows the owner to edit test case inputs, annotate expected outputs, and
// add new cases while the benchmark is still in draft. The "draft only"
// invariant lives on the aggregate now; this use case only orchestrates.
export class UpdateTestCasesUseCase {
  constructor(
    private readonly benchmarks: IBenchmarkRepository,
    private readonly promptQueries: IPromptQueryService,
    private readonly idGenerator: IIdGenerator,
    private readonly costEstimator: BenchmarkCostEstimator = new BenchmarkCostEstimator(),
  ) {}

  async execute(command: UpdateTestCasesCommand): Promise<void> {
    const benchmark = await ensureBenchmarkAccess(
      this.benchmarks,
      command.benchmarkId,
      command.ownerId,
    );
    benchmark.editDraftTestCases({
      updates: command.updates,
      additions: command.additions.map((a) => ({
        id: this.idGenerator.newId(),
        input: a.input,
        expectedOutput: a.expectedOutput,
        category: a.category ?? null,
      })),
    });

    const versionsById = await this.promptQueries.findVersionSummariesByIds(
      benchmark.promptVersionIds,
    );
    const missing = benchmark.promptVersionIds.filter((id) => !versionsById.has(id));
    if (missing.length > 0) {
      throw ValidationError(`PromptVersion(s) not found: ${missing.join(", ")}`);
    }
    const costForecast = this.costEstimator.estimate({
      versions: benchmark.promptVersionIds.map((id) => versionsById.get(id)!),
      generatedInputs: benchmark.testCases.map((testCase) => testCase.input),
      solverModels: benchmark.solverModels,
      judgeModels: benchmark.judgeModels,
      repetitions: benchmark.repetitions,
    });
    benchmark.refreshCostForecast(costForecast);
    await this.benchmarks.save(benchmark);
  }
}
