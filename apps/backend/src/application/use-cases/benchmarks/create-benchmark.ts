import type { Benchmark } from "../../../domain/entities/benchmark.js";
import type { IBenchmarkRepository } from "../../../domain/repositories/benchmark-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import { NotFoundError } from "../../../domain/errors/domain-error.js";
import type { CreateBenchmarkDto } from "../../dto/benchmark-dto.js";
import { ModelRegistry } from "../../services/model-registry.js";
import { TestCaseGenerator } from "../../services/benchmark/test-case-generator.js";
import type { IAIProviderFactory } from "../../services/ai-provider.js";

// Creates a benchmark in "draft" status, generating test cases from the first
// prompt version's content so the user can review and optionally annotate them
// with expected outputs before starting the run.

export interface CreateBenchmarkCommand extends CreateBenchmarkDto {
  ownerId: string;
}

export class CreateBenchmarkUseCase {
  constructor(
    private readonly benchmarks: IBenchmarkRepository,
    private readonly versions: IPromptVersionRepository,
    private readonly providers: IAIProviderFactory,
  ) {}

  async execute(command: CreateBenchmarkCommand): Promise<Benchmark> {
    const resolvedVersions = await this.loadVersions(command.promptVersionIds);

    ModelRegistry.require(command.judgeModel);
    ModelRegistry.require(command.generatorModel);
    for (const model of command.solverModels) {
      ModelRegistry.require(model);
    }

    const generator = new TestCaseGenerator(this.providers);
    const generated = await generator.generate(
      resolvedVersions[0]!.classicalPrompt,
      command.testCount,
      command.generatorModel,
    );

    return this.benchmarks.create({
      name: command.name,
      ownerId: command.ownerId,
      promptVersionIds: command.promptVersionIds,
      solverModels: command.solverModels,
      judgeModel: command.judgeModel,
      generatorModel: command.generatorModel,
      testCount: command.testCount,
      testCases: generated.map((tc) => ({ id: tc.id, input: tc.input, expectedOutput: null })),
      concurrency: command.concurrency,
    });
  }

  private async loadVersions(ids: string[]) {
    const resolved = await Promise.all(ids.map((id) => this.versions.findById(id)));
    for (let i = 0; i < ids.length; i++) {
      if (!resolved[i]) throw NotFoundError(`PromptVersion ${ids[i]} not found`);
    }
    return resolved as NonNullable<(typeof resolved)[number]>[];
  }
}
