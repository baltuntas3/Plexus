import { atom } from "jotai";
import type {
  BraidChatRequest,
  BraidChatResponse,
  BraidNodeKind,
  GraphQualityScoreDto,
  LintVersionResponse,
  ModelInfoDto,
  ModelListResponse,
  PromptVariableInput,
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

// ── Visual editor structural-edit primitives ────────────────────────────────

// Every primitive forks a new draft version, so the response shape is
// identical (newVersion + qualityScore). AddBraidNode also returns the
// auto-generated `nodeId` so the caller can address the new node
// without re-fetching the graph.
export interface BraidEditResponse {
  newVersion: string;
  qualityScore: GraphQualityScoreDto;
}

export interface AddBraidNodeResponse extends BraidEditResponse {
  nodeId: string;
}

const callBraidEdit = async <T extends BraidEditResponse>(
  token: string,
  url: string,
  body?: unknown,
): Promise<T> =>
  apiRequest<T>(url, body ? { method: "POST", body, token } : { method: "POST", token });

export const renameBraidNodeAtom = atom(
  null,
  async (
    get,
    set,
    params: {
      promptId: string;
      version: string;
      nodeId: string;
      newLabel: string;
      // Inline-declared variables when the new label introduces
      // `{{var}}` references not yet on the source.
      addVariables?: ReadonlyArray<PromptVariableInput>;
    },
  ): Promise<BraidEditResponse> => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    const res = await callBraidEdit<BraidEditResponse>(
      tokens.accessToken,
      `/prompts/${params.promptId}/versions/${params.version}/braid/nodes/${params.nodeId}/rename`,
      { newLabel: params.newLabel, addVariables: params.addVariables },
    );
    set(promptDetailRefreshAtom, (n) => n + 1);
    return res;
  },
);

export const addBraidNodeAtom = atom(
  null,
  async (
    get,
    set,
    params: {
      promptId: string;
      version: string;
      label: string;
      kind: BraidNodeKind;
      // Inline-declared variables when the new label introduces
      // `{{var}}` references not yet on the source.
      addVariables?: ReadonlyArray<PromptVariableInput>;
    },
  ): Promise<AddBraidNodeResponse> => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    const res = await callBraidEdit<AddBraidNodeResponse>(
      tokens.accessToken,
      `/prompts/${params.promptId}/versions/${params.version}/braid/nodes`,
      {
        label: params.label,
        kind: params.kind,
        addVariables: params.addVariables,
      },
    );
    set(promptDetailRefreshAtom, (n) => n + 1);
    return res;
  },
);

export const removeBraidNodeAtom = atom(
  null,
  async (
    get,
    set,
    params: { promptId: string; version: string; nodeId: string },
  ): Promise<BraidEditResponse> => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    const res = await callBraidEdit<BraidEditResponse>(
      tokens.accessToken,
      `/prompts/${params.promptId}/versions/${params.version}/braid/nodes/${params.nodeId}/remove`,
    );
    set(promptDetailRefreshAtom, (n) => n + 1);
    return res;
  },
);

export const addBraidEdgeAtom = atom(
  null,
  async (
    get,
    set,
    params: {
      promptId: string;
      version: string;
      fromNodeId: string;
      toNodeId: string;
      label?: string | null;
    },
  ): Promise<BraidEditResponse> => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    const res = await callBraidEdit<BraidEditResponse>(
      tokens.accessToken,
      `/prompts/${params.promptId}/versions/${params.version}/braid/edges/add`,
      {
        fromNodeId: params.fromNodeId,
        toNodeId: params.toNodeId,
        label: params.label ?? null,
      },
    );
    set(promptDetailRefreshAtom, (n) => n + 1);
    return res;
  },
);

export const removeBraidEdgeAtom = atom(
  null,
  async (
    get,
    set,
    params: {
      promptId: string;
      version: string;
      fromNodeId: string;
      toNodeId: string;
      label?: string | null;
    },
  ): Promise<BraidEditResponse> => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    const res = await callBraidEdit<BraidEditResponse>(
      tokens.accessToken,
      `/prompts/${params.promptId}/versions/${params.version}/braid/edges/remove`,
      {
        fromNodeId: params.fromNodeId,
        toNodeId: params.toNodeId,
        label: params.label ?? null,
      },
    );
    set(promptDetailRefreshAtom, (n) => n + 1);
    return res;
  },
);

// Layout persistence — node positions only, no fork. Empty
// `positions` array clears the saved layout. Doesn't bump the prompt
// detail refresh counter: the version itself didn't change identity,
// only its presentation metadata, so subscribed reads don't need to
// re-fetch (the visual editor already has the positions in memory).
export const updateBraidLayoutAtom = atom(
  null,
  async (
    get,
    _set,
    params: {
      promptId: string;
      version: string;
      positions: ReadonlyArray<{ nodeId: string; x: number; y: number }>;
    },
  ): Promise<void> => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    await apiRequest<void>(
      `/prompts/${params.promptId}/versions/${params.version}/braid/layout`,
      {
        method: "PUT",
        body: { positions: params.positions },
        token: tokens.accessToken,
      },
    );
  },
);

export const relabelBraidEdgeAtom = atom(
  null,
  async (
    get,
    set,
    params: {
      promptId: string;
      version: string;
      fromNodeId: string;
      toNodeId: string;
      oldLabel?: string | null;
      newLabel?: string | null;
    },
  ): Promise<BraidEditResponse> => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    const res = await callBraidEdit<BraidEditResponse>(
      tokens.accessToken,
      `/prompts/${params.promptId}/versions/${params.version}/braid/edges/relabel`,
      {
        fromNodeId: params.fromNodeId,
        toNodeId: params.toNodeId,
        oldLabel: params.oldLabel ?? null,
        newLabel: params.newLabel ?? null,
      },
    );
    set(promptDetailRefreshAtom, (n) => n + 1);
    return res;
  },
);
