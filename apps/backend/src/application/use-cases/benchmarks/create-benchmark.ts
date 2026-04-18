import type { Benchmark } from "../../../domain/entities/benchmark.js";
import type { IBenchmarkRepository } from "../../../domain/repositories/benchmark-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import { NotFoundError } from "../../../domain/errors/domain-error.js";
import type { CreateBenchmarkDto } from "../../dto/benchmark-dto.js";
import {
  ModelRegistry,
  pickGeneratorModel,
  pickJudgeModels,
} from "../../services/model-registry.js";
import {
  TestCaseGenerator,
  buildEvaluationSpecFromVersions,
} from "../../services/benchmark/test-case-generator.js";
import type { IAIProviderFactory } from "../../services/ai-provider.js";

// Creates a benchmark in "draft" status, generating test cases from the
// selected prompt versions so the user can review and optionally annotate them
// with expected outputs before starting the run.
//
// The caller only chooses what to benchmark (versions, solver models) and how
// many cases to probe. Everything that makes a benchmark fair and reproducible
// — judge ensemble, generator model, test-generation mode, repetitions, seed,
// concurrency — is derived here so the surface area stays minimal but the
// defaults are explicit.

const DEFAULT_GENERATOR_MODEL = "openai/gpt-oss-120b";
const DEFAULT_JUDGE_COUNT = 3;
const DEFAULT_REPETITIONS = 3;
const DEFAULT_CONCURRENCY = 4;

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

    for (const model of command.solverModels) {
      ModelRegistry.require(model);
    }

    const judgeModels = pickJudgeModels(command.solverModels, DEFAULT_JUDGE_COUNT);
    const generatorModel = pickGeneratorModel(
      command.solverModels,
      DEFAULT_GENERATOR_MODEL,
    );
    const analysisModel = judgeModels[0] ?? null;
    const testGenerationMode =
      resolvedVersions.length > 1 ? "diff-seeking" : "shared-core";
    const seed = generateSeed();

    const spec = buildEvaluationSpecFromVersions(
      resolvedVersions,
      testGenerationMode,
      seed,
    );
    const generator = new TestCaseGenerator(this.providers);
    const generated = await generator.generate(
      spec,
      command.testCount,
      generatorModel,
      seed,
    );

    return this.benchmarks.create({
      name: command.name,
      ownerId: command.ownerId,
      promptVersionIds: command.promptVersionIds,
      solverModels: command.solverModels,
      judgeModels,
      generatorModel,
      testGenerationMode,
      analysisModel,
      testCount: command.testCount,
      repetitions: DEFAULT_REPETITIONS,
      seed,
      testCases: generated.map((tc) => ({
        id: tc.id,
        input: tc.input,
        expectedOutput: null,
        category: tc.category,
        source: "generated" as const,
      })),
      concurrency: DEFAULT_CONCURRENCY,
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

const generateSeed = (): number => Math.floor(Math.random() * 0x7fffffff);
