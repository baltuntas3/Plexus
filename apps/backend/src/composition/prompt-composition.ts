import { MongoPromptAggregateRepository } from "../infrastructure/persistence/mongoose/mongo-prompt-aggregate-repository.js";
import { MongoPromptQueryService } from "../infrastructure/persistence/mongoose/mongo-prompt-query-service.js";
import type { IPromptQueryService } from "../application/queries/prompt-query-service.js";
import type { IPromptAggregateRepository } from "../domain/repositories/prompt-aggregate-repository.js";
import { CreatePromptUseCase } from "../application/use-cases/prompts/create-prompt.js";
import { ListPromptsUseCase } from "../application/use-cases/prompts/list-prompts.js";
import { GetPromptUseCase } from "../application/use-cases/prompts/get-prompt.js";
import { CreateVersionUseCase } from "../application/use-cases/prompts/create-version.js";
import { ListVersionsUseCase } from "../application/use-cases/prompts/list-versions.js";
import { GetVersionUseCase } from "../application/use-cases/prompts/get-version.js";
import { PromoteVersionUseCase } from "../application/use-cases/prompts/promote-version.js";
import { UpdateVersionNameUseCase } from "../application/use-cases/prompts/update-version-name.js";
import { GenerateBraidUseCase } from "../application/use-cases/prompts/generate-braid.js";
import { LintVersionUseCase } from "../application/use-cases/prompts/lint-version.js";
import { UpdateBraidGraphUseCase } from "../application/use-cases/prompts/update-braid-graph.js";
import { ChatBraidUseCase } from "../application/use-cases/prompts/chat-braid.js";
import type { BraidGenerator } from "../application/services/braid/braid-generator.js";
import type { GraphLinter } from "../application/services/braid/lint/graph-linter.js";
import type { IAIProviderFactory } from "../application/services/ai-provider.js";

export interface PromptComposition {
  createPrompt: CreatePromptUseCase;
  listPrompts: ListPromptsUseCase;
  getPrompt: GetPromptUseCase;
  createVersion: CreateVersionUseCase;
  listVersions: ListVersionsUseCase;
  getVersion: GetVersionUseCase;
  promoteVersion: PromoteVersionUseCase;
  updateVersionName: UpdateVersionNameUseCase;
  generateBraid: GenerateBraidUseCase;
  lintVersion: LintVersionUseCase;
  updateBraidGraph: UpdateBraidGraphUseCase;
  chatBraid: ChatBraidUseCase;
  promptAggregateRepository: IPromptAggregateRepository;
  promptQueryService: IPromptQueryService;
}

export const createPromptComposition = (
  generator: BraidGenerator,
  providers: IAIProviderFactory,
  linter: GraphLinter,
): PromptComposition => {
  const prompts = new MongoPromptAggregateRepository();
  const queries = new MongoPromptQueryService();

  return {
    createPrompt: new CreatePromptUseCase(prompts),
    listPrompts: new ListPromptsUseCase(queries),
    getPrompt: new GetPromptUseCase(prompts),
    createVersion: new CreateVersionUseCase(prompts),
    listVersions: new ListVersionsUseCase(prompts),
    getVersion: new GetVersionUseCase(prompts),
    promoteVersion: new PromoteVersionUseCase(prompts),
    updateVersionName: new UpdateVersionNameUseCase(prompts),
    generateBraid: new GenerateBraidUseCase(prompts, generator, linter),
    lintVersion: new LintVersionUseCase(prompts, linter),
    updateBraidGraph: new UpdateBraidGraphUseCase(prompts, linter),
    chatBraid: new ChatBraidUseCase(prompts, providers, linter),
    promptAggregateRepository: prompts,
    promptQueryService: queries,
  };
};
