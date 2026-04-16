import { MongoPromptRepository } from "../infrastructure/persistence/mongoose/mongo-prompt-repository.js";
import { MongoPromptVersionRepository } from "../infrastructure/persistence/mongoose/mongo-prompt-version-repository.js";
import { CreatePromptUseCase } from "../application/use-cases/prompts/create-prompt.js";
import { ListPromptsUseCase } from "../application/use-cases/prompts/list-prompts.js";
import { GetPromptUseCase } from "../application/use-cases/prompts/get-prompt.js";
import { CreateVersionUseCase } from "../application/use-cases/prompts/create-version.js";
import { ListVersionsUseCase } from "../application/use-cases/prompts/list-versions.js";
import { GetVersionUseCase } from "../application/use-cases/prompts/get-version.js";
import { PromoteVersionUseCase } from "../application/use-cases/prompts/promote-version.js";
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
  generateBraid: GenerateBraidUseCase;
  lintVersion: LintVersionUseCase;
  updateBraidGraph: UpdateBraidGraphUseCase;
  chatBraid: ChatBraidUseCase;
}

export const createPromptComposition = (
  generator: BraidGenerator,
  providers: IAIProviderFactory,
  linter: GraphLinter,
): PromptComposition => {
  const prompts = new MongoPromptRepository();
  const versions = new MongoPromptVersionRepository();

  return {
    createPrompt: new CreatePromptUseCase(prompts, versions),
    listPrompts: new ListPromptsUseCase(prompts),
    getPrompt: new GetPromptUseCase(prompts),
    createVersion: new CreateVersionUseCase(prompts, versions),
    listVersions: new ListVersionsUseCase(prompts, versions),
    getVersion: new GetVersionUseCase(prompts, versions),
    promoteVersion: new PromoteVersionUseCase(prompts, versions),
    generateBraid: new GenerateBraidUseCase(prompts, versions, generator, linter),
    lintVersion: new LintVersionUseCase(prompts, versions, linter),
    updateBraidGraph: new UpdateBraidGraphUseCase(prompts, versions, linter),
    chatBraid: new ChatBraidUseCase(prompts, versions, providers, linter),
  };
};
