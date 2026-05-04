import { atom } from "jotai";
import type {
  BenchmarkAnalysisDto,
  BenchmarkDetailDto,
  BenchmarkListResponse,
  CreateBenchmarkRequest,
  UpdateTestCasesRequest,
} from "@plexus/shared-types";
import { apiRequest } from "../lib/api-client.js";
import { tokensAtom } from "./auth.atoms.js";

export const createBenchmarkAtom = atom(
  null,
  async (get, _set, input: CreateBenchmarkRequest): Promise<BenchmarkDetailDto> => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    const result = await apiRequest<{ benchmark: BenchmarkDetailDto }>("/benchmarks", {
      method: "POST",
      body: input,
      token: tokens.accessToken,
    });
    return result.benchmark;
  },
);

export const updateTestCasesAtom = atom(
  null,
  async (
    get,
    _set,
    { benchmarkId, updates, additions }: { benchmarkId: string } & UpdateTestCasesRequest,
  ): Promise<void> => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    await apiRequest(`/benchmarks/${benchmarkId}/test-cases`, {
      method: "PATCH",
      body: { updates, additions },
      token: tokens.accessToken,
    });
  },
);

export const startBenchmarkAtom = atom(
  null,
  async (get, _set, benchmarkId: string): Promise<{ benchmarkId: string; jobId: string }> => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    return apiRequest(`/benchmarks/${benchmarkId}/start`, {
      method: "POST",
      token: tokens.accessToken,
    });
  },
);

export const fetchBenchmarkAnalysisAtom = atom(
  null,
  async (get, _set, benchmarkId: string): Promise<BenchmarkAnalysisDto> => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    const result = await apiRequest<{ analysis: BenchmarkAnalysisDto }>(
      `/benchmarks/${benchmarkId}/analysis`,
      { token: tokens.accessToken },
    );
    return result.analysis;
  },
);

export const fetchBenchmarkDetailAtom = atom(
  null,
  async (get, _set, benchmarkId: string): Promise<BenchmarkDetailDto> => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    const result = await apiRequest<{ benchmark: BenchmarkDetailDto }>(
      `/benchmarks/${benchmarkId}`,
      { token: tokens.accessToken },
    );
    return result.benchmark;
  },
);

// Bumped after a successful create-benchmark so the Past Evaluations panel
// re-fetches without forcing the user to navigate away and back.
export const benchmarksListRefreshAtom = atom(0);

// Read-side fetch scoped to a single prompt version. The list endpoint
// does the filter server-side; the frontend just hands over the version id.
export const fetchBenchmarksForVersionAtom = atom(
  null,
  async (
    get,
    _set,
    args: { promptVersionId: string; page?: number; pageSize?: number },
  ): Promise<BenchmarkListResponse> => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    // Read so updates to the refresh counter trigger re-execution when the
    // caller wraps this in a useAtomValue/loadable read pattern.
    get(benchmarksListRefreshAtom);
    const params = new URLSearchParams({
      promptVersionId: args.promptVersionId,
      page: String(args.page ?? 1),
      pageSize: String(args.pageSize ?? 20),
    });
    return apiRequest<BenchmarkListResponse>(`/benchmarks?${params.toString()}`, {
      token: tokens.accessToken,
    });
  },
);
