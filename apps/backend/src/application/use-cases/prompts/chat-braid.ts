import type { IPromptRepository } from "../../../domain/repositories/prompt-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import { NotFoundError } from "../../../domain/errors/domain-error.js";
import { BraidGraph } from "../../../domain/value-objects/braid-graph.js";
import { TokenCost } from "../../../domain/value-objects/token-cost.js";
import type { GraphQualityScore } from "../../../domain/value-objects/graph-quality-score.js";
import type { IAIProviderFactory } from "../../services/ai-provider.js";
import { calculateCost } from "../../services/model-registry.js";
import { BraidChatAgent } from "../../services/braid/braid-chat-agent.js";
import type { GraphLinter } from "../../services/braid/lint/graph-linter.js";
import { ensurePromptAccess } from "./ensure-prompt-access.js";

export interface ChatBraidCommand {
  promptId: string;
  version: string;
  ownerId: string;
  userMessage: string;
  generatorModel: string;
  // If provided the agent refines the given graph; otherwise generates from scratch.
  currentMermaid?: string;
}

export interface ChatBraidResult {
  mermaidCode: string;
  qualityScore: GraphQualityScore;
  cost: TokenCost;
}

export class ChatBraidUseCase {
  constructor(
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
    private readonly providers: IAIProviderFactory,
    private readonly linter: GraphLinter,
  ) {}

  async execute(command: ChatBraidCommand): Promise<ChatBraidResult> {
    const prompt = await ensurePromptAccess(this.prompts, command.promptId, command.ownerId);

    const version = await this.versions.findByPromptAndVersion(
      command.promptId,
      command.version,
    );
    if (!version) {
      throw NotFoundError("Version not found");
    }

    const provider = this.providers.forModel(command.generatorModel);
    const agent = new BraidChatAgent(provider, command.generatorModel);

    const chatResult = await agent.chat({
      classicalPrompt: version.classicalPrompt,
      taskType: prompt.taskType,
      userMessage: command.userMessage,
      currentMermaid: command.currentMermaid,
    });

    // Validate output; throws ValidationError on bad Mermaid
    const graph = BraidGraph.parse(chatResult.mermaidCode);

    // Persist — preserve existing generatorModel on refinement
    if (command.currentMermaid) {
      await this.versions.updateBraidGraph(version.id, graph.mermaidCode);
    } else {
      await this.versions.setBraidGraph(version.id, graph.mermaidCode, command.generatorModel);
    }

    const cost = calculateCost(
      command.generatorModel,
      chatResult.totalInputTokens,
      chatResult.totalOutputTokens,
    );
    const qualityScore = this.linter.lint(graph);

    return { mermaidCode: graph.mermaidCode, qualityScore, cost };
  }
}
