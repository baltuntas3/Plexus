import { atom } from "jotai";
import type {
  BenchmarkAnalysisDto,
  BenchmarkDetailDto,
  BenchmarkDto,
  BenchmarkJudgeAnalysisDto,
  CreateBenchmarkRequest,
  Paginated,
  UpdateTestCasesRequest,
} from "@plexus/shared-types";
import { apiRequest } from "../lib/api-client.js";
import { tokensAtom } from "./auth.atoms.js";

const PAGE_SIZE = 20;

export const benchmarksListRefreshAtom = atom(0);
export const benchmarksListPageAtom = atom(1);

export const benchmarksListAtom = atom(async (get) => {
  get(benchmarksListRefreshAtom);
  const tokens = get(tokensAtom);
  if (!tokens) {
    return { items: [], total: 0, page: 1, pageSize: PAGE_SIZE } satisfies Paginated<BenchmarkDto>;
  }
  const page = get(benchmarksListPageAtom);
  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  return apiRequest<Paginated<BenchmarkDto>>(`/benchmarks?${query.toString()}`, {
    token: tokens.accessToken,
  });
});

export const createBenchmarkAtom = atom(
  null,
  async (get, set, input: CreateBenchmarkRequest): Promise<BenchmarkDetailDto> => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    const result = await apiRequest<{ benchmark: BenchmarkDetailDto }>("/benchmarks", {
      method: "POST",
      body: input,
      token: tokens.accessToken,
    });
    set(benchmarksListRefreshAtom, (n) => n + 1);
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

export const fetchBenchmarkJudgeAnalysisAtom = atom(
  null,
  async (get, _set, benchmarkId: string): Promise<BenchmarkJudgeAnalysisDto> => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    const result = await apiRequest<{ analysis: BenchmarkJudgeAnalysisDto }>(
      `/benchmarks/${benchmarkId}/judge-analysis`,
      { token: tokens.accessToken },
    );
    return result.analysis;
  },
);

export const benchmarkDetailRefreshAtom = atom(0);

export const fetchBenchmarkDetailAtom = atom(
  null,
  async (get, _set, benchmarkId: string): Promise<BenchmarkDetailDto> => {
    const tokens = get(tokensAtom);
    if (!tokens) throw new Error("Not authenticated");
    get(benchmarkDetailRefreshAtom);
    const result = await apiRequest<{ benchmark: BenchmarkDetailDto }>(
      `/benchmarks/${benchmarkId}`,
      { token: tokens.accessToken },
    );
    return result.benchmark;
  },
);
