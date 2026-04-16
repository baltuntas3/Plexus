import { atom } from "jotai";
import type {
  ChatBraidRequest,
  ChatBraidResponse,
  GraphQualityScoreDto,
  LintVersionResponse,
  ModelInfoDto,
  ModelListResponse,
  UpdateBraidResponse,
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

export interface UpdateBraidParams {
  promptId: string;
  version: string;
  mermaidCode: string;
}

export const updateBraidAtom = atom(
  null,
  async (get, set, params: UpdateBraidParams): Promise<GraphQualityScoreDto> => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    const result = await apiRequest<UpdateBraidResponse>(
      `/prompts/${params.promptId}/versions/${params.version}/braid`,
      { method: "PATCH", body: { mermaidCode: params.mermaidCode }, token: tokens.accessToken },
    );
    set(promptDetailRefreshAtom, (n) => n + 1);
    return result.qualityScore;
  },
);

export interface ChatBraidParams {
  promptId: string;
  version: string;
  body: ChatBraidRequest;
}

export const chatBraidAtom = atom(
  null,
  async (get, _set, params: ChatBraidParams): Promise<ChatBraidResponse> => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    // Single API call — response already contains mermaidCode + qualityScore.
    // The caller updates local state directly via handleChatResult, so no
    // promptDetailRefreshAtom increment is needed here.
    return apiRequest<ChatBraidResponse>(
      `/prompts/${params.promptId}/versions/${params.version}/braid/chat`,
      { method: "POST", body: params.body, token: tokens.accessToken },
    );
  },
);
