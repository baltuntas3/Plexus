import type { IPromptAggregateRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import { BraidGraph } from "../../../domain/value-objects/braid-graph.js";
import { TokenCost } from "../../../domain/value-objects/token-cost.js";
import type { GraphQualityScore } from "../../../domain/value-objects/graph-quality-score.js";
import { calculateCost } from "../../services/model-registry.js";
import type { IBraidChatAgentFactory } from "../../services/braid/braid-chat-agent-factory.js";
import type { GraphLinter } from "../../services/braid/lint/graph-linter.js";
import { loadOwnedPrompt } from "./load-owned-prompt.js";

export interface ChatBraidCommand {
  promptId: string;
  version: string;
  ownerId: string;
  userMessage: string;
  generatorModel: string;
  // If provided the agent refines the given graph; otherwise generates from scratch.
  currentMermaid?: string;
}

export type ChatBraidResult =
  | { type: "question"; question: string }
  | {
      type: "diagram";
      mermaidCode: string;
      // Non-null when initial generation created a new version; null on refinement.
      newVersionName: string | null;
      qualityScore: GraphQualityScore;
      cost: TokenCost;
    };

export class ChatBraidUseCase {
  constructor(
    private readonly prompts: IPromptAggregateRepository,
    private readonly agents: IBraidChatAgentFactory,
    private readonly linter: GraphLinter,
    private readonly idGenerator: IIdGenerator,
  ) {}

  async execute(command: ChatBraidCommand): Promise<ChatBraidResult> {
    const prompt = await loadOwnedPrompt(this.prompts, command.promptId, command.ownerId);
    const version = prompt.getVersionOrThrow(command.version);

    const agent = this.agents.forModel(command.generatorModel);

    const chatResult = await agent.chat({
      sourcePrompt: version.sourcePrompt,
      taskType: prompt.taskType,
      userMessage: command.userMessage,
      currentMermaid: command.currentMermaid,
    });

    // Agent asked a clarifying question — nothing to save or lint.
    if (chatResult.type === "question") {
      return { type: "question", question: chatResult.question };
    }

    // Validate output; throws ValidationError on bad Mermaid
    const graph = BraidGraph.parse(chatResult.mermaidCode);

    const cost = calculateCost(
      command.generatorModel,
      chatResult.totalInputTokens,
      chatResult.totalOutputTokens,
    );
    const qualityScore = this.linter.lint(graph);

    if (command.currentMermaid) {
      prompt.updateBraidGraph(command.version, graph);
      await this.prompts.save(prompt);
      return { type: "diagram", mermaidCode: graph.mermaidCode, newVersionName: null, qualityScore, cost };
    }

    const { version: newVersion } = prompt.attachGeneratedBraid({
      sourceVersion: command.version,
      graph,
      generatorModel: command.generatorModel,
      forkVersionId: this.idGenerator.newId(),
    });
    await this.prompts.save(prompt);

    return {
      type: "diagram",
      mermaidCode: graph.mermaidCode,
      newVersionName: newVersion.version,
      qualityScore,
      cost,
    };
  }
}
