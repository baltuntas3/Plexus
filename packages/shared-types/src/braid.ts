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
  qualityScore: GraphQualityScoreDto;
}

export interface ChatBraidRequest {
  userMessage: string;
  generatorModel: string;
  currentMermaid?: string;
}

export interface ChatBraidResponse {
  mermaidCode: string;
  qualityScore: GraphQualityScoreDto;
  usage: { totalUsd: number };
}
