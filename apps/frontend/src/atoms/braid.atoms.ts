import { atom } from "jotai";
import type {
  BraidChatRequest,
  BraidChatResponse,
  GraphQualityScoreDto,
  LintVersionResponse,
  ModelInfoDto,
  ModelListResponse,
  SaveBraidFromChatRequest,
  SaveBraidFromChatResponse,
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

export interface BraidChatParams {
  promptId: string;
  version: string;
  body: BraidChatRequest;
}

// Stateless multi-turn chat. Caller maintains the history in memory
// (component state, not localStorage) and sends the full prior history
// with each turn. Backend never persists the transcript — the only
// artifact that survives is the version forked via `saveBraidFromChat`.
// No `promptDetailRefreshAtom` bump because chat alone never mutates
// server state.
export const braidChatAtom = atom(
  null,
  async (get, _set, params: BraidChatParams): Promise<BraidChatResponse> => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    return apiRequest<BraidChatResponse>(
      `/prompts/${params.promptId}/versions/${params.version}/braid/chat`,
      { method: "POST", body: params.body, token: tokens.accessToken },
    );
  },
);

export interface SaveBraidFromChatParams {
  promptId: string;
  version: string;
  body: SaveBraidFromChatRequest;
}

// Persists a chat-suggested mermaid as a new forked version. Bumps the
// detail refresh counter so the prompt-detail page picks up the new
// version row without a manual reload.
export const saveBraidFromChatAtom = atom(
  null,
  async (
    get,
    set,
    params: SaveBraidFromChatParams,
  ): Promise<SaveBraidFromChatResponse> => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    const res = await apiRequest<SaveBraidFromChatResponse>(
      `/prompts/${params.promptId}/versions/${params.version}/braid/save-from-chat`,
      { method: "POST", body: params.body, token: tokens.accessToken },
    );
    set(promptDetailRefreshAtom, (n) => n + 1);
    return res;
  },
);
