import type {
  BraidAuthorshipDto,
  TaskType,
  VersionStatus,
} from "@plexus/shared-types";

// Read-side contract for the Prompt aggregate. Lives in the application layer
// because pagination/search/summary projection is read orchestration, not a
// domain concept. The domain layer only keeps the write port
// (IPromptAggregateRepository) that protects aggregate invariants.
//
// All read endpoints return plain projections (PromptSummary /
// PromptVersionSummary). Entities never cross this boundary: a projection
// cannot be mutated and re-saved by accident, which is the classic CQRS
// "half-loaded aggregate" trap. Write paths go through the aggregate
// repository instead so mutations always operate on a fully-hydrated Prompt.

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

// Read projection for prompt versions. Mirrors PromptVersion's public shape
// but carries no behavior. `executablePrompt` is pre-resolved (braid graph
// when present, otherwise the classical source) so benchmark callers can
// build evaluation inputs without caring about representation discrimination.
export interface PromptVersionSummary {
  id: string;
  promptId: string;
  version: string;
  name: string | null;
  parentVersionId: string | null;
  sourcePrompt: string;
  braidGraph: string | null;
  braidAuthorship: BraidAuthorshipDto | null;
  // Convenience projection of `braidAuthorship`. See PromptVersionDto for
  // the full semantics: model id for "model" authorship, derivedFromModel
  // for "manual" authorship (null when unknown).
  generatorModel: string | null;
  executablePrompt: string;
  status: VersionStatus;
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

export interface ListVersionSummariesQuery {
  promptId: string;
  page: number;
  pageSize: number;
}

export interface VersionSummaryListResult {
  items: PromptVersionSummary[];
  total: number;
}

export interface IPromptQueryService {
  listPromptSummaries(query: ListPromptSummariesQuery): Promise<PromptSummaryListResult>;
  // Collapses "missing prompt" and "not yours" into a single null response so
  // presentation can uniformly 404 and avoid leaking existence of prompts
  // owned by others. Callers should not need to compose findById + owner
  // check themselves.
  findOwnedPromptSummary(
    promptId: string,
    ownerId: string,
  ): Promise<PromptSummary | null>;
  // Owner-scoped by-id lookups. A caller that cannot prove ownership sees
  // the prompts/versions as if they do not exist — the presentation layer
  // can uniformly 404 without leaking "exists but not yours". Critical
  // where foreign ids would otherwise cross a bounded-context boundary
  // (e.g. benchmark creation consuming PromptVersion ids from a request
  // body).
  findOwnedPromptSummariesByIds(
    ids: readonly string[],
    ownerId: string,
  ): Promise<Map<string, PromptSummary>>;
  listVersionSummaries(query: ListVersionSummariesQuery): Promise<VersionSummaryListResult>;
  findOwnedVersionSummary(
    id: string,
    ownerId: string,
  ): Promise<PromptVersionSummary | null>;
  findOwnedVersionSummariesByIds(
    ids: readonly string[],
    ownerId: string,
  ): Promise<Map<string, PromptVersionSummary>>;
}
