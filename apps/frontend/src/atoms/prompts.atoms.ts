import { atom } from "jotai";
import type {
  CreatePromptRequest,
  CreateVersionRequest,
  Paginated,
  PromoteVersionRequest,
  PromptDto,
  PromptVersionDto,
  UpdateVersionRequest,
} from "@plexus/shared-types";
import { apiRequest } from "../lib/api-client.js";
import { tokensAtom } from "./auth.atoms.js";

export const promptsListRefreshAtom = atom(0);
export const promptsListPageAtom = atom(1);
export const promptsListSearchAtom = atom("");

const PAGE_SIZE = 20;

export const promptsListAtom = atom(async (get) => {
  get(promptsListRefreshAtom);
  const tokens = get(tokensAtom);
  if (!tokens) {
    return { items: [], total: 0, page: 1, pageSize: PAGE_SIZE } satisfies Paginated<PromptDto>;
  }
  const page = get(promptsListPageAtom);
  const search = get(promptsListSearchAtom).trim();
  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (search) query.set("search", search);
  return apiRequest<Paginated<PromptDto>>(`/prompts?${query.toString()}`, {
    token: tokens.accessToken,
  });
});

export const createPromptAtom = atom(
  null,
  async (get, set, input: CreatePromptRequest) => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    const result = await apiRequest<{ prompt: PromptDto; version: PromptVersionDto }>("/prompts", {
      method: "POST",
      body: input,
      token: tokens.accessToken,
    });
    set(promptsListRefreshAtom, (n) => n + 1);
    return result;
  },
);

export const promptDetailRefreshAtom = atom(0);

export interface PromptDetail {
  prompt: PromptDto;
  versions: PromptVersionDto[];
}

export const fetchPromptDetailAtom = atom(
  null,
  async (get, _set, promptId: string): Promise<PromptDetail> => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    get(promptDetailRefreshAtom);
    const token = tokens.accessToken;
    const [prompt, versions] = await Promise.all([
      apiRequest<{ prompt: PromptDto }>(`/prompts/${promptId}`, { token }),
      apiRequest<Paginated<PromptVersionDto>>(`/prompts/${promptId}/versions?pageSize=100`, {
        token,
      }),
    ]);
    return { prompt: prompt.prompt, versions: versions.items };
  },
);

export const createVersionAtom = atom(
  null,
  async (get, set, params: { promptId: string; input: CreateVersionRequest }) => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    const result = await apiRequest<{ version: PromptVersionDto }>(
      `/prompts/${params.promptId}/versions`,
      { method: "POST", body: params.input, token: tokens.accessToken },
    );
    set(promptDetailRefreshAtom, (n) => n + 1);
    return result.version;
  },
);

export const promoteVersionAtom = atom(
  null,
  async (
    get,
    set,
    params: { promptId: string; version: string; input: PromoteVersionRequest },
  ) => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    const result = await apiRequest<{ version: PromptVersionDto }>(
      `/prompts/${params.promptId}/versions/${params.version}/promote`,
      { method: "POST", body: params.input, token: tokens.accessToken },
    );
    set(promptDetailRefreshAtom, (n) => n + 1);
    set(promptsListRefreshAtom, (n) => n + 1);
    return result.version;
  },
);

export const updateVersionNameAtom = atom(
  null,
  async (
    get,
    set,
    params: { promptId: string; version: string; input: UpdateVersionRequest },
  ) => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    const result = await apiRequest<{ version: PromptVersionDto }>(
      `/prompts/${params.promptId}/versions/${params.version}`,
      { method: "PATCH", body: params.input, token: tokens.accessToken },
    );
    set(promptDetailRefreshAtom, (n) => n + 1);
    return result.version;
  },
);

