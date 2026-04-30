import type {
  BraidAuthorshipDto,
  BraidGraphLayoutDto,
  PromptVariableDto,
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
  organizationId: string;
  creatorId: string;
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
  // Canonical mermaid serialisation. The visual editor parses this
  // client-side; backend ships the raw string only.
  braidGraph: string | null;
  // Persisted node positions for the visual editor. Null when the
  // user hasn't dragged anything yet — the editor falls back to
  // auto-layout.
  braidGraphLayout: BraidGraphLayoutDto | null;
  braidAuthorship: BraidAuthorshipDto | null;
  // Convenience projection of `braidAuthorship`. See PromptVersionDto for
  // the full semantics: model id for "model" authorship, derivedFromModel
  // for "manual" authorship (null when unknown).
  generatorModel: string | null;
  variables: PromptVariableDto[];
  executablePrompt: string;
  status: VersionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListPromptSummariesQuery {
  organizationId: string;
  page: number;
  pageSize: number;
  search?: string;
}

export interface PromptSummaryListResult {
  items: PromptSummary[];
  total: number;
}

export interface ListVersionSummariesInOrgQuery {
  promptId: string;
  organizationId: string;
  page: number;
  pageSize: number;
}

export interface VersionSummaryListResult {
  items: PromptVersionSummary[];
  total: number;
}

export interface IPromptQueryService {
  listPromptSummaries(
    query: ListPromptSummariesQuery,
  ): Promise<PromptSummaryListResult>;
  // Collapses "missing prompt" and "belongs to a different org" into a
  // single null response so presentation can uniformly 404 and avoid
  // leaking existence of prompts in other tenants.
  findPromptSummaryInOrganization(
    promptId: string,
    organizationId: string,
  ): Promise<PromptSummary | null>;
  // Organization-scoped by-id lookups. A caller from another org sees the
  // prompts/versions as if they do not exist — the presentation layer can
  // uniformly 404 without leaking cross-tenant existence. Critical where
  // foreign ids would otherwise cross a bounded-context boundary (e.g.
  // benchmark creation consuming PromptVersion ids from a request body).
  findPromptSummariesByIdsInOrganization(
    ids: readonly string[],
    organizationId: string,
  ): Promise<Map<string, PromptSummary>>;
  // Org-scoped list. Returns `null` when the prompt is missing or in a
  // different org — collapses both into a single 404-shaped response at
  // the query-service boundary so the access rule lives in one place
  // instead of being composed by every caller.
  listVersionSummariesInOrganization(
    query: ListVersionSummariesInOrgQuery,
  ): Promise<VersionSummaryListResult | null>;
  // Direct (promptId, label) lookup, org-scoped. Expresses the ubiquitous-
  // language operation "get version vN of this prompt" in one query instead
  // of forcing callers to list-then-filter. Returns null for missing prompt,
  // missing label, or cross-tenant access — presentation uniformly 404s.
  findVersionByLabelInOrganization(
    promptId: string,
    label: string,
    organizationId: string,
  ): Promise<PromptVersionSummary | null>;
  findVersionSummaryInOrganization(
    id: string,
    organizationId: string,
  ): Promise<PromptVersionSummary | null>;
  findVersionSummariesByIdsInOrganization(
    ids: readonly string[],
    organizationId: string,
  ): Promise<Map<string, PromptVersionSummary>>;
}
