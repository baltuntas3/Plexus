import type { BraidChatTurn } from "@plexus/shared-types";
import { ValidationError } from "../../../domain/errors/domain-error.js";
import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import { BraidGraph } from "../../../domain/value-objects/braid-graph.js";
import type { GraphQualityScore } from "../../../domain/value-objects/graph-quality-score.js";
import { TokenCost } from "../../../domain/value-objects/token-cost.js";
import {
  MAX_BRAID_CHAT_HISTORY_MESSAGES,
  MAX_BRAID_CHAT_TOTAL_CHARACTERS,
} from "../../dto/braid-dto.js";
import type { IBraidChatAgentFactory } from "../../services/braid/braid-chat-agent-factory.js";
import type { GraphLinter } from "../../services/braid/lint/graph-linter.js";
import { calculateCost } from "../../services/model-registry.js";
import { assertVariableIntegrity } from "../../services/prompts/variable-integrity.js";
import { loadPromptAndVersionInOrganization } from "./load-owned-prompt.js";

// Stateless multi-turn BRAID chat. The frontend maintains the
// conversation in memory and sends the **full** prior history every
// turn; the backend never persists transcripts. Persistence happens
// separately via `SaveBraidFromChatUseCase` when the user clicks
// "Save this version".
//
// Hard-limit constants are imported from the boundary DTO so the Zod
// schema and this defense-in-depth check share the same numbers.

export interface BraidChatCommand {
  promptId: string;
  version: string;
  organizationId: string;
  userId: string;
  userMessage: string;
  history: BraidChatTurn[];
  generatorModel: string;
}

export type BraidChatResult =
  | { type: "question"; question: string; cost: TokenCost }
  | {
      type: "diagram";
      mermaidCode: string;
      qualityScore: GraphQualityScore;
      cost: TokenCost;
    };

export class BraidChatUseCase {
  constructor(
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
    private readonly agents: IBraidChatAgentFactory,
    private readonly linter: GraphLinter,
  ) {}

  async execute(command: BraidChatCommand): Promise<BraidChatResult> {
    enforceHistoryLimits(command.history, command.userMessage);

    const { prompt, version: source } = await loadPromptAndVersionInOrganization(
      this.prompts,
      this.versions,
      command.promptId,
      command.version,
      command.organizationId,
    );

    const agent = this.agents.forModel(command.generatorModel);
    const chatResult = await agent.chat({
      sourcePrompt: source.sourcePrompt,
      taskType: prompt.taskType,
      userMessage: command.userMessage,
      history: command.history,
      currentMermaid: source.braidGraph?.mermaidCode,
      variableNames: source.variables.map((v) => v.name),
    });
    const cost = calculateCost(
      command.generatorModel,
      chatResult.totalInputTokens,
      chatResult.totalOutputTokens,
    );

    if (chatResult.type === "question") {
      return { type: "question", question: chatResult.question, cost };
    }

    // Defense-in-depth: agent must preserve declared `{{varName}}`
    // references. Rejected here so the suggestion never reaches the
    // user with broken variable bindings — the user can re-prompt
    // with clearer constraints.
    const graph = BraidGraph.parse(chatResult.mermaidCode);
    assertVariableIntegrity({
      body: source.sourcePrompt,
      mermaid: graph.mermaidCode,
      variables: source.variables,
    });
    const qualityScore = this.linter.lint(graph);

    return {
      type: "diagram",
      mermaidCode: graph.mermaidCode,
      qualityScore,
      cost,
    };
  }
}

const enforceHistoryLimits = (
  history: BraidChatTurn[],
  userMessage: string,
): void => {
  if (history.length > MAX_BRAID_CHAT_HISTORY_MESSAGES) {
    throw ValidationError(
      `Conversation history exceeds the ${MAX_BRAID_CHAT_HISTORY_MESSAGES}-message limit; start a new chat.`,
    );
  }
  const totalChars =
    userMessage.length
    + history.reduce((sum, turn) => sum + turn.content.length, 0);
  if (totalChars > MAX_BRAID_CHAT_TOTAL_CHARACTERS) {
    throw ValidationError(
      `Conversation is too long (~${Math.round(totalChars / 4)} tokens); start a new chat.`,
    );
  }
};
