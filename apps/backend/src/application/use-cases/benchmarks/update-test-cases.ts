import type { BenchmarkTestCase } from "../../../domain/entities/benchmark.js";
import type { IBenchmarkRepository } from "../../../domain/repositories/benchmark-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import type { IPromptQueryService } from "../../queries/prompt-query-service.js";
import { ValidationError } from "../../../domain/errors/domain-error.js";
import {
  averageTokenCount,
  estimateBenchmarkCost,
} from "../../services/benchmark/benchmark-cost-estimator.js";
import { ensureBenchmarkAccess } from "./ensure-benchmark-access.js";

interface UpdateTestCasesCommand {
  benchmarkId: string;
  organizationId: string;
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
  ) {}

  async execute(command: UpdateTestCasesCommand): Promise<void> {
    const benchmark = await ensureBenchmarkAccess(
      this.benchmarks,
      command.benchmarkId,
      command.organizationId,
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

    const versionsById = await this.promptQueries.findVersionSummariesByIdsInOrganization(
      benchmark.promptVersionIds,
      benchmark.organizationId,
    );
    const missing = benchmark.promptVersionIds.filter((id) => !versionsById.has(id));
    if (missing.length > 0) {
      throw ValidationError(`PromptVersion(s) not found: ${missing.join(", ")}`);
    }
    const inputs = benchmark.testCases.map((testCase) => testCase.input);
    const costForecast = estimateBenchmarkCost({
      versions: benchmark.promptVersionIds.map((id) => versionsById.get(id)!),
      testCount: inputs.length,
      avgInputTokens: averageTokenCount(inputs),
      solverModels: benchmark.solverModels,
      judgeModels: benchmark.judgeModels,
      repetitions: benchmark.repetitions,
    });
    benchmark.refreshCostForecast(costForecast);
    await this.benchmarks.save(benchmark);
  }
}
