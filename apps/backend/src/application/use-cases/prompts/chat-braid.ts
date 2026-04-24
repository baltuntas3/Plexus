import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import { PromptVersion } from "../../../domain/entities/prompt-version.js";
import { BraidAuthorship } from "../../../domain/value-objects/braid-authorship.js";
import { BraidGraph } from "../../../domain/value-objects/braid-graph.js";
import { TokenCost } from "../../../domain/value-objects/token-cost.js";
import type { GraphQualityScore } from "../../../domain/value-objects/graph-quality-score.js";
import { calculateCost } from "../../services/model-registry.js";
import type { IBraidChatAgentFactory } from "../../services/braid/braid-chat-agent-factory.js";
import type { GraphLinter } from "../../services/braid/lint/graph-linter.js";
import { loadOwnedPromptAndVersion } from "./load-owned-prompt.js";

// Refinement vs. initial-generation is a domain fact — "does this version
// already carry a BRAID?" — not something the client should assert. The
// current mermaid is read from the version aggregate itself, so a stale
// client snapshot can never steer the LLM into refining the wrong diagram.
//
// Because PromptVersion content is immutable, both refinement and initial
// generation produce a new forked version here. The source version stays
// untouched either way.

export interface ChatBraidCommand {
  promptId: string;
  version: string;
  ownerId: string;
  userMessage: string;
  generatorModel: string;
}

export type ChatBraidResult =
  | { type: "question"; question: string }
  | {
      type: "diagram";
      mermaidCode: string;
      newVersionName: string;
      qualityScore: GraphQualityScore;
      cost: TokenCost;
    };

export class ChatBraidUseCase {
  constructor(
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
    private readonly agents: IBraidChatAgentFactory,
    private readonly linter: GraphLinter,
    private readonly idGenerator: IIdGenerator,
  ) {}

  async execute(command: ChatBraidCommand): Promise<ChatBraidResult> {
    const { prompt, version: source } = await loadOwnedPromptAndVersion(
      this.prompts,
      this.versions,
      command.promptId,
      command.version,
      command.ownerId,
    );

    const agent = this.agents.forModel(command.generatorModel);

    const currentMermaid = source.braidGraph?.mermaidCode;
    const chatResult = await agent.chat({
      sourcePrompt: source.sourcePrompt,
      taskType: prompt.taskType,
      userMessage: command.userMessage,
      currentMermaid,
    });

    if (chatResult.type === "question") {
      return { type: "question", question: chatResult.question };
    }

    const graph = BraidGraph.parse(chatResult.mermaidCode);
    const cost = calculateCost(
      command.generatorModel,
      chatResult.totalInputTokens,
      chatResult.totalOutputTokens,
    );
    const qualityScore = this.linter.lint(graph);

    const label = prompt.allocateNextVersionLabel();
    const forked = PromptVersion.fork({
      source,
      newId: this.idGenerator.newId(),
      newLabel: label,
      initialBraid: {
        graph,
        authorship: BraidAuthorship.byModel(command.generatorModel),
      },
    });

    await this.versions.save(forked);
    await this.prompts.save(prompt);

    return {
      type: "diagram",
      mermaidCode: graph.mermaidCode,
      newVersionName: forked.version,
      qualityScore,
      cost,
    };
  }
}
