import type { TaskType } from "@plexus/shared-types";
import type { PromptVersion } from "../../domain/entities/prompt-version.js";

// Read-side contract for the Prompt aggregate. Lives in the application layer
// because pagination/search/summary projection is read orchestration, not a
// domain concept. The domain layer only keeps the write port
// (IPromptAggregateRepository) that protects aggregate invariants.
//
// List endpoints return `PromptSummary` (no versions) — never a half-loaded
// aggregate. Single-prompt or single-version reads go through the aggregate
// repository instead, so write-path callers always operate on a fully-
// hydrated Prompt.

export interface PromptSummary {
  id: string;
  name: string;
  description: string;
  taskType: TaskType;
  ownerId: string;
  productionVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListPromptSummariesQuery {
  ownerId: string;
  page: number;
  pageSize: number;
  search?: string;
}

export interface PromptSummaryListResult {
  items: PromptSummary[];
  total: number;
}

export interface IPromptQueryService {
  listPromptSummaries(query: ListPromptSummariesQuery): Promise<PromptSummaryListResult>;
  findPromptSummariesByIds(ids: readonly string[]): Promise<Map<string, PromptSummary>>;
  findVersionById(id: string): Promise<PromptVersion | null>;
  findVersionsByIds(ids: readonly string[]): Promise<Map<string, PromptVersion>>;
}
