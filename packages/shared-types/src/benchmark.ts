import type { ISODateString, Paginated } from "./common.js";

export type BenchmarkStatus = "draft" | "queued" | "running" | "completed" | "failed";
export type BenchmarkResultStatus = "completed" | "failed";

export interface BenchmarkProgressDto {
  completed: number;
  total: number;
}

export interface BenchmarkDto {
  id: string;
  name: string;
  ownerId: string;
  promptVersionIds: string[];
  solverModels: string[];
  judgeModel: string;
  generatorModel: string;
  testCount: number;
  concurrency: number;
  status: BenchmarkStatus;
  progress: BenchmarkProgressDto;
  jobId: string | null;
  error: string | null;
  createdAt: ISODateString;
  startedAt: ISODateString | null;
  completedAt: ISODateString | null;
}

export interface BenchmarkResultDto {
  id: string;
  benchmarkId: string;
  testCaseId: string;
  promptVersionId: string;
  solverModel: string;
  input: string;
  candidateOutput: string;
  judgeAccuracy: number;
  judgeCoherence: number;
  judgeInstruction: number;
  judgeReasoning: string;
  rawScore: number;
  verbosityPenalty: number;
  finalScore: number;
  candidateInputTokens: number;
  candidateOutputTokens: number;
  candidateCostUsd: number;
  judgeInputTokens: number;
  judgeOutputTokens: number;
  judgeCostUsd: number;
  totalCostUsd: number;
  latencyMs: number;
  status: BenchmarkResultStatus;
  error: string | null;
  createdAt: ISODateString;
}

export interface CreateBenchmarkRequest {
  name: string;
  promptVersionIds: string[];
  solverModels: string[];
  judgeModel: string;
  generatorModel: string;
  testCount: number;
  concurrency?: number;
}

export type BenchmarkListResponse = Paginated<BenchmarkDto>;

export interface BenchmarkTestCaseDto {
  id: string;
  input: string;
  expectedOutput: string | null;
}

export interface UpdateTestCasesRequest {
  updates: Array<{ id: string; expectedOutput: string | null }>;
}

export interface BenchmarkDetailDto extends BenchmarkDto {
  results: BenchmarkResultDto[];
  testCases: BenchmarkTestCaseDto[];
}

// SSE progress event payload.
export interface BenchmarkProgressEvent {
  benchmarkId: string;
  status: BenchmarkStatus;
  progress: BenchmarkProgressDto;
}

// PPD Dashboard types.

export interface CandidateDto {
  promptVersionId: string;
  solverModel: string;
  meanFinalScore: number;
  totalCostUsd: number;
  completedCount: number;
  failedCount: number;
  candidateKey: string;
}

export interface PPDRowDto {
  candidateKey: string;
  ppd: number;
  isMoreEfficient: boolean;
}

export interface BenchmarkAnalysisDto {
  candidates: CandidateDto[];
  paretoFrontierKeys: string[];
  baselineKey: string | null;
  ppd: PPDRowDto[];
  recommendedKey: string | null;
}
