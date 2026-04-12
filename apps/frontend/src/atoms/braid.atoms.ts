import { atom } from "jotai";
import type {
  BraidGraphDto,
  BraidTokenUsageDto,
  GenerateBraidRequest,
  GenerateBraidResponse,
  GraphQualityScoreDto,
  LintVersionResponse,
  ModelInfoDto,
  ModelListResponse,
  PromptVersionDto,
} from "@plexus/shared-types";
import { apiRequest } from "../lib/api-client.js";
import { tokensAtom } from "./auth.atoms.js";
import { promptDetailRefreshAtom } from "./prompts.atoms.js";

export const modelsAtom = atom(async (get) => {
  const tokens = get(tokensAtom);
  if (!tokens) return [] as ModelInfoDto[];
  const res = await apiRequest<ModelListResponse>("/models", { token: tokens.accessToken });
  return res.items;
});

export interface GenerateBraidParams {
  promptId: string;
  version: string;
  input: GenerateBraidRequest;
}

export interface GenerateBraidOutcome {
  version: PromptVersionDto;
  graph: BraidGraphDto;
  cached: boolean;
  usage: BraidTokenUsageDto;
  qualityScore: GraphQualityScoreDto;
}

export const generateBraidAtom = atom(
  null,
  async (get, set, params: GenerateBraidParams): Promise<GenerateBraidOutcome> => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    const result = await apiRequest<GenerateBraidResponse>(
      `/prompts/${params.promptId}/versions/${params.version}/generate-braid`,
      { method: "POST", body: params.input, token: tokens.accessToken },
    );
    set(promptDetailRefreshAtom, (n) => n + 1);
    return result as GenerateBraidOutcome;
  },
);

export interface LintParams {
  promptId: string;
  version: string;
}

export const lintVersionAtom = atom(
  null,
  async (get, _set, params: LintParams): Promise<GraphQualityScoreDto> => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    const result = await apiRequest<LintVersionResponse>(
      `/prompts/${params.promptId}/versions/${params.version}/lint`,
      { method: "POST", token: tokens.accessToken },
    );
    return result.qualityScore;
  },
);
