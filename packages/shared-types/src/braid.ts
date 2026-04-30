import type { GraphQualityScoreDto } from "./lint.js";

export interface BraidNodeDto {
  id: string;
  label: string;
}

export interface BraidEdgeDto {
  from: string;
  to: string;
  label: string | null;
}

export interface BraidGraphDto {
  mermaidCode: string;
  nodes: BraidNodeDto[];
  edges: BraidEdgeDto[];
}

export interface GenerateBraidRequest {
  generatorModel: string;
  forceRegenerate?: boolean;
}

export interface BraidTokenUsageDto {
  inputTokens: number;
  outputTokens: number;
  totalUsd: number;
}

export interface GenerateBraidResponse {
  version: {
    id: string;
    promptId: string;
    version: string;
    braidGraph: string;
    generatorModel: string;
  };
  graph: BraidGraphDto;
  cached: boolean;
  usage: BraidTokenUsageDto;
  qualityScore: GraphQualityScoreDto;
}

export interface UpdateBraidRequest {
  mermaidCode: string;
}

export interface UpdateBraidResponse {
  // New forked version label. PromptVersion content is immutable; a manual
  // mermaid edit always creates a new version rather than rewriting the
  // source in place.
  newVersion: string;
  qualityScore: GraphQualityScoreDto;
}

// Single turn of the BRAID chat conversation. The role mirrors the
// chat-completion convention; "agent" is preferred over "assistant"
// for readability since the user-facing label says "Agent".
export interface BraidChatTurn {
  role: "user" | "agent";
  content: string;
}

// Stateless chat request. The frontend maintains the conversation in
// memory (no localStorage, no backend persistence) and sends the
// **full** prior history with each turn so the LLM gets multi-turn
// context. Backend never stores the transcript.
export interface BraidChatRequest {
  // Conversation history *prior* to the current message. Empty for the
  // first turn. Each turn is taken at face value — backend never edits
  // or rewrites past entries.
  history: BraidChatTurn[];
  // The user's new message for this turn. Sent separately so the
  // backend does not have to assume the last `history` row is the
  // current message.
  userMessage: string;
  generatorModel: string;
}

// Stateless chat response. Notably **no `newVersion` field** — chat is
// pure suggestion now, persistence is a separate `SaveBraidFromChat`
// call when the user clicks "Save this version".
export type BraidChatResponse =
  | { type: "question"; question: string; usage: { totalUsd: number } }
  | {
      type: "diagram";
      mermaidCode: string;
      qualityScore: GraphQualityScoreDto;
      usage: { totalUsd: number };
    };

// Save a previously-suggested mermaid graph as a new forked version.
// Caller passes the mermaid the chat agent produced; the use case
// re-runs variable-integrity + lint defenses and forks a new version
// off the conversation's source.
export interface SaveBraidFromChatRequest {
  mermaidCode: string;
  // The model that produced the diagram during chat. Recorded as the
  // forked version's `BraidAuthorship.byModel(generatorModel)` for
  // audit so a saved version's provenance points back to the chat
  // turn that generated it.
  generatorModel: string;
}

export interface SaveBraidFromChatResponse {
  // The forked version's label. Status starts as `draft`; promotion to
  // staging/production goes through the regular `PromoteVersion` flow.
  newVersion: string;
  qualityScore: GraphQualityScoreDto;
}
