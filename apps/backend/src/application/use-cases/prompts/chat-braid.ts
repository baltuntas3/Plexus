import type { IPromptAggregateRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import { BraidAuthorship } from "../../../domain/value-objects/braid-authorship.js";
import { BraidGraph } from "../../../domain/value-objects/braid-graph.js";
import { TokenCost } from "../../../domain/value-objects/token-cost.js";
import type { GraphQualityScore } from "../../../domain/value-objects/graph-quality-score.js";
import { calculateCost } from "../../services/model-registry.js";
import type { IBraidChatAgentFactory } from "../../services/braid/braid-chat-agent-factory.js";
import type { GraphLinter } from "../../services/braid/lint/graph-linter.js";
import { loadOwnedPrompt } from "./load-owned-prompt.js";

// Refinement vs. initial-generation is a domain fact — "does this version
// already carry a BRAID?" — not something the client should assert. The
// current mermaid is read from the aggregate itself, so a stale client
// snapshot can never steer the LLM into refining the wrong diagram.
//
// Because PromptVersion content is immutable, both refinement and initial
// generation produce a *new* forked version here. The difference is only
// which model (the caller's `generatorModel` for fresh generation, or the
// parent's model for refinement) is recorded on the fork — the source
// version stays untouched either way.

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
      // The forked version's label — both refinement and initial generation
      // always produce a new version now that content is immutable.
      newVersionName: string;
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

    // Refinement mode is determined by aggregate state, not by the client.
    // `version.braidGraph?.mermaidCode` is the canonical "current" diagram —
    // whatever the user's browser thinks it is, this is the one the LLM sees.
    const currentMermaid = version.braidGraph?.mermaidCode;
    const chatResult = await agent.chat({
      sourcePrompt: version.sourcePrompt,
      taskType: prompt.taskType,
      userMessage: command.userMessage,
      currentMermaid,
    });

    // Agent asked a clarifying question — nothing to save or lint.
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

    // Record the model that actually produced this artifact. The agent was
    // built with `command.generatorModel`, the LLM call ran with that model,
    // the cost was calculated against that model — the fork's metadata must
    // match. `parentVersionId` already answers "what came before", so there
    // is no need to double-encode lineage into authorship.
    const forked = prompt.upsertBraid({
      version: command.version,
      graph,
      authorship: BraidAuthorship.byModel(command.generatorModel),
      forkVersionId: this.idGenerator.newId(),
    });
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
