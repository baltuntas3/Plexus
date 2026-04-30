import { MongoOrganizationRepository } from "../infrastructure/persistence/mongoose/mongo-organization-repository.js";
import { MongoPromptAggregateRepository } from "../infrastructure/persistence/mongoose/mongo-prompt-aggregate-repository.js";
import { MongoPromptVersionRepository } from "../infrastructure/persistence/mongoose/mongo-prompt-version-repository.js";
import { MongoPromptQueryService } from "../infrastructure/persistence/mongoose/mongo-prompt-query-service.js";
import { MongoObjectIdGenerator } from "../infrastructure/persistence/mongoose/object-id-generator.js";
import { MongoUnitOfWork } from "../infrastructure/persistence/mongoose/mongo-unit-of-work.js";
import type { IPromptQueryService } from "../application/queries/prompt-query-service.js";
import type { IIdGenerator } from "../domain/services/id-generator.js";
import type { IUnitOfWork } from "../domain/services/unit-of-work.js";
import { CreatePromptUseCase } from "../application/use-cases/prompts/create-prompt.js";
import { ListPromptsUseCase } from "../application/use-cases/prompts/list-prompts.js";
import { GetPromptUseCase } from "../application/use-cases/prompts/get-prompt.js";
import { CreateVersionUseCase } from "../application/use-cases/prompts/create-version.js";
import { ListVersionsUseCase } from "../application/use-cases/prompts/list-versions.js";
import { GetVersionUseCase } from "../application/use-cases/prompts/get-version.js";
import { CompareVersionsUseCase } from "../application/use-cases/prompts/compare-versions.js";
import { PromoteVersionUseCase } from "../application/use-cases/prompts/promote-version.js";
import { UpdateVersionNameUseCase } from "../application/use-cases/prompts/update-version-name.js";
import { GenerateBraidUseCase } from "../application/use-cases/prompts/generate-braid.js";
import { LintVersionUseCase } from "../application/use-cases/prompts/lint-version.js";
import { UpdateBraidGraphUseCase } from "../application/use-cases/prompts/update-braid-graph.js";
import { UpdateBraidGraphLayoutUseCase } from "../application/use-cases/prompts/update-braid-graph-layout.js";
import {
  AddBraidEdgeUseCase,
  AddBraidNodeUseCase,
  type PrimitiveDeps,
  RelabelBraidEdgeUseCase,
  RemoveBraidEdgeUseCase,
  RemoveBraidNodeUseCase,
  RenameBraidNodeUseCase,
} from "../application/use-cases/prompts/edit-braid-primitives.js";
import { BraidChatUseCase } from "../application/use-cases/prompts/braid-chat.js";
import { SaveBraidFromChatUseCase } from "../application/use-cases/prompts/save-braid-from-chat.js";
import type { BraidGenerator } from "../application/services/braid/braid-generator.js";
import type { GraphLinter } from "../application/services/braid/lint/graph-linter.js";
import type { IAIProviderFactory } from "../application/services/ai-provider.js";
import { BraidChatAgentFactory } from "../application/services/braid/braid-chat-agent-factory.js";

// Context boundary: only the capabilities required by presentation and by
// adjacent bounded contexts (benchmark reads the published read model) are
// exposed. Internal ports — write repositories, id generation, UoW — are
// kept private to the prompt composition so other contexts cannot reach
// past the use-case surface and mutate Prompt state directly.
export interface PromptComposition {
  createPrompt: CreatePromptUseCase;
  listPrompts: ListPromptsUseCase;
  getPrompt: GetPromptUseCase;
  createVersion: CreateVersionUseCase;
  listVersions: ListVersionsUseCase;
  getVersion: GetVersionUseCase;
  promoteVersion: PromoteVersionUseCase;
  compareVersions: CompareVersionsUseCase;
  updateVersionName: UpdateVersionNameUseCase;
  generateBraid: GenerateBraidUseCase;
  lintVersion: LintVersionUseCase;
  updateBraidGraph: UpdateBraidGraphUseCase;
  updateBraidGraphLayout: UpdateBraidGraphLayoutUseCase;
  renameBraidNode: RenameBraidNodeUseCase;
  addBraidNode: AddBraidNodeUseCase;
  removeBraidNode: RemoveBraidNodeUseCase;
  addBraidEdge: AddBraidEdgeUseCase;
  removeBraidEdge: RemoveBraidEdgeUseCase;
  relabelBraidEdge: RelabelBraidEdgeUseCase;
  braidChat: BraidChatUseCase;
  saveBraidFromChat: SaveBraidFromChatUseCase;
  promptQueryService: IPromptQueryService;
}

export const createPromptComposition = (
  generator: BraidGenerator,
  providers: IAIProviderFactory,
  linter: GraphLinter,
): PromptComposition => {
  const prompts = new MongoPromptAggregateRepository();
  const versions = new MongoPromptVersionRepository();
  const organizations = new MongoOrganizationRepository();
  const queries = new MongoPromptQueryService();
  const idGenerator: IIdGenerator = new MongoObjectIdGenerator();
  const uow: IUnitOfWork = new MongoUnitOfWork();
  const chatAgents = new BraidChatAgentFactory(providers);
  const primitiveDeps: PrimitiveDeps = { prompts, versions, linter, idGenerator, uow };

  return {
    createPrompt: new CreatePromptUseCase(prompts, versions, idGenerator, uow),
    listPrompts: new ListPromptsUseCase(queries),
    getPrompt: new GetPromptUseCase(queries),
    createVersion: new CreateVersionUseCase(prompts, versions, idGenerator, uow),
    listVersions: new ListVersionsUseCase(queries),
    getVersion: new GetVersionUseCase(queries),
    promoteVersion: new PromoteVersionUseCase(prompts, versions, organizations, uow),
    compareVersions: new CompareVersionsUseCase(prompts, versions),
    updateVersionName: new UpdateVersionNameUseCase(prompts, versions),
    generateBraid: new GenerateBraidUseCase(
      prompts,
      versions,
      generator,
      linter,
      idGenerator,
      uow,
    ),
    lintVersion: new LintVersionUseCase(prompts, versions, linter),
    updateBraidGraph: new UpdateBraidGraphUseCase(prompts, versions, linter, idGenerator, uow),
    updateBraidGraphLayout: new UpdateBraidGraphLayoutUseCase(prompts, versions),
    renameBraidNode: new RenameBraidNodeUseCase(primitiveDeps),
    addBraidNode: new AddBraidNodeUseCase(primitiveDeps),
    removeBraidNode: new RemoveBraidNodeUseCase(primitiveDeps),
    addBraidEdge: new AddBraidEdgeUseCase(primitiveDeps),
    removeBraidEdge: new RemoveBraidEdgeUseCase(primitiveDeps),
    relabelBraidEdge: new RelabelBraidEdgeUseCase(primitiveDeps),
    braidChat: new BraidChatUseCase(prompts, versions, chatAgents, linter),
    saveBraidFromChat: new SaveBraidFromChatUseCase(
      prompts,
      versions,
      linter,
      idGenerator,
      uow,
    ),
    promptQueryService: queries,
  };
};
