import { atom } from "jotai";
import type { Atom } from "jotai";
import type {
  CreatePromptRequest,
  CreateVersionRequest,
  Paginated,
  PromoteVersionRequest,
  PromptDto,
  PromptVersionDto,
  UpdateVersionRequest,
  VersionComparisonDto,
} from "@plexus/shared-types";
import { apiRequest } from "../lib/api-client.js";
import { tokensAtom } from "./auth.atoms.js";

// ── List ────────────────────────────────────────────────────────────────────

export const promptsListRefreshAtom = atom(0);
export const promptsListSearchAtom = atom("");

const PAGE_SIZE = 20;

export const promptsListAtom = atom(async (get) => {
  get(promptsListRefreshAtom);
  const tokens = get(tokensAtom);
  if (!tokens) {
    return { items: [], total: 0, page: 1, pageSize: PAGE_SIZE } satisfies Paginated<PromptDto>;
  }
  const search = get(promptsListSearchAtom).trim();
  const query = new URLSearchParams({ page: "1", pageSize: String(PAGE_SIZE) });
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

// ── Detail ──────────────────────────────────────────────────────────────────

export const promptDetailRefreshAtom = atom(0);

export interface PromptDetail {
  prompt: PromptDto;
  versions: PromptVersionDto[];
}

// Canonical async read atom keyed by promptId. Mirrors the
// `membersRefreshAtom + membersAtom` pattern in organizations.atoms.ts:
// reads the refresh counter as a dependency, so any mutation that bumps
// the counter triggers a re-fetch in subscribed components. Pages consume
// it with `useAtomValue` (suspends on first load) or with `loadable` when
// they want to keep prior data visible while the refetch is in flight.
//
// Memoised by promptId via a manual map (the same approach
// draft-history.atoms.ts uses) so each prompt has a stable atom identity
// across renders and atomFamily's cleanup concerns are sidestepped.
type PromptDetailAtom = Atom<Promise<PromptDetail>>;
const promptDetailAtoms = new Map<string, PromptDetailAtom>();

export const getPromptDetailAtom = (promptId: string): PromptDetailAtom => {
  const existing = promptDetailAtoms.get(promptId);
  if (existing) return existing;
  const a = atom(async (get): Promise<PromptDetail> => {
    get(promptDetailRefreshAtom);
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    const token = tokens.accessToken;
    const [prompt, versions] = await Promise.all([
      apiRequest<{ prompt: PromptDto }>(`/prompts/${promptId}`, { token }),
      apiRequest<Paginated<PromptVersionDto>>(`/prompts/${promptId}/versions?pageSize=100`, {
        token,
      }),
    ]);
    return { prompt: prompt.prompt, versions: versions.items };
  });
  promptDetailAtoms.set(promptId, a);
  return a;
};

// Imperative fetch variant. Retained for pages that need synchronous
// post-fetch initialisation side effects (e.g. seeding a Monaco draft
// buffer once on mount). New consumers should prefer
// `getPromptDetailAtom`. The refresh counter is bumped by mutations
// below; subscribed read atoms re-fetch automatically — this write atom
// only re-fetches when its setter is invoked again, so callers must
// re-invoke it after a mutation if they hold the result locally.
export const fetchPromptDetailAtom = atom(
  null,
  async (get, _set, promptId: string): Promise<PromptDetail> => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
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

// ── Mutations ───────────────────────────────────────────────────────────────

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

// Read-side imperative fetch: the comparison view is opened by user
// interaction (a "Compare" button on the prompt detail page) and
// shouldn't subscribe to a refresh counter — the comparison is a
// snapshot at the time the page opens, not a live mirror.
export const compareVersionsAtom = atom(
  null,
  async (
    get,
    _set,
    params: { promptId: string; baseVersion: string; targetVersion: string },
  ): Promise<VersionComparisonDto> => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    const query = new URLSearchParams({
      base: params.baseVersion,
      target: params.targetVersion,
    });
    const res = await apiRequest<{ comparison: VersionComparisonDto }>(
      `/prompts/${params.promptId}/versions-compare?${query.toString()}`,
      { token: tokens.accessToken },
    );
    return res.comparison;
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
