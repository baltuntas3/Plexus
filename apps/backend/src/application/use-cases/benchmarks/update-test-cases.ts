import { randomUUID } from "node:crypto";
import type { BenchmarkTestCase } from "../../../domain/entities/benchmark.js";
import type { IBenchmarkRepository } from "../../../domain/repositories/benchmark-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import { ValidationError } from "../../../domain/errors/domain-error.js";
import { estimateBenchmarkCost } from "./create-benchmark.js";
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
// add new cases while the benchmark is still in "draft" status.
export class UpdateTestCasesUseCase {
  constructor(
    private readonly benchmarks: IBenchmarkRepository,
    private readonly versions: IPromptVersionRepository,
  ) {}

  async execute(command: UpdateTestCasesCommand): Promise<void> {
    const bm = await ensureBenchmarkAccess(
      this.benchmarks,
      command.benchmarkId,
      command.ownerId,
    );
    if (bm.status !== "draft") {
      throw ValidationError(
        "Test cases can only be edited while the benchmark is in draft status",
      );
    }
    const additions = command.additions.map((a) => ({
      ...a,
      id: randomUUID(),
      category: a.category ?? null,
      source: "manual" as const,
    }));
    await this.benchmarks.updateTestCases(command.benchmarkId, command.updates, additions);
    const nextTestCases = bm.testCases
      .map((testCase) => {
        const update = command.updates.find((item) => item.id === testCase.id);
        if (!update) return testCase;
        return {
          ...testCase,
          input: update.input ?? testCase.input,
          expectedOutput: update.expectedOutput,
          category: update.category !== undefined ? update.category : testCase.category,
        };
      })
      .concat(additions);
    const versions = await Promise.all(
      bm.promptVersionIds.map((id) => this.versions.findById(id)),
    );
    const missing = bm.promptVersionIds.filter((_, index) => !versions[index]);
    if (missing.length > 0) {
      throw ValidationError(`PromptVersion(s) not found: ${missing.join(", ")}`);
    }
    const costForecast = estimateBenchmarkCost({
      versions: versions as NonNullable<(typeof versions)[number]>[],
      generatedInputs: nextTestCases.map((testCase) => testCase.input),
      solverModels: bm.solverModels,
      judgeModels: bm.judgeModels,
      repetitions: bm.repetitions,
    });
    await this.benchmarks.updateCostForecast(command.benchmarkId, costForecast);
  }
}
