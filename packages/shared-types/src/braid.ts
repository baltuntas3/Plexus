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

export interface ChatBraidRequest {
  userMessage: string;
  generatorModel: string;
}

export type ChatBraidResponse =
  | { type: "question"; question: string }
  | {
      type: "diagram";
      mermaidCode: string;
      // The forked version's label. Both initial generation and refinement
      // produce a new, immutable version — there is no "silent refine in
      // place" path anymore.
      newVersion: string;
      qualityScore: GraphQualityScoreDto;
      usage: { totalUsd: number };
    };
