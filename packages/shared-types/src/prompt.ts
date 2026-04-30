import type { BraidGraphLayoutDto } from "./braid.js";
import type { ISODateString, Paginated } from "./common.js";

export const TASK_TYPES = ["general", "math", "creative", "instruction-following", "code"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const VERSION_STATUSES = ["draft", "development", "staging", "production"] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

export interface PromptDto {
  id: string;
  name: string;
  description: string;
  taskType: TaskType;
  organizationId: string;
  creatorId: string;
  productionVersion: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// Authorship provenance for a BRAID artifact.
//
//   kind "model"  — an LLM ran end-to-end and produced this graph.
//   kind "manual" — a human edited the mermaid directly; derivedFromModel
//                   is the model id of the ancestor the edit started from
//                   (null when no ancestor's model was recorded).
export type BraidAuthorshipDto =
  | { kind: "model"; model: string }
  | { kind: "manual"; derivedFromModel: string | null };

export interface PromptVariableDto {
  name: string;
  description: string | null;
  defaultValue: string | null;
  required: boolean;
}

export interface PromptVersionDto {
  id: string;
  promptId: string;
  version: string;
  // User-friendly label for this version. Null means the user has not named
  // it; UIs should fall back to `version` (e.g. "v1") in that case.
  name: string | null;
  // Lineage pointer. Null for the initial version created with the prompt;
  // set to the source version's id when a new version is forked from an edit
  // (manual mermaid edit, regenerate, or chat refinement). Enables a version
  // tree in the UI and preserves audit trail: which prompt produced which
  // benchmark result stays answerable because versions are immutable.
  parentVersionId: string | null;
  sourcePrompt: string;
  // Canonical mermaid serialisation. The visual editor parses this
  // client-side via `parseBraidMermaid` — the backend ships the raw
  // string only and the structured projection lives in the frontend.
  braidGraph: string | null;
  // Persisted node positions for the visual editor. Null until the
  // user has dragged at least one node — the editor falls back to
  // deterministic auto-layout for nodes without entries. Saving a
  // layout mutates this version in place (no fork): layout is
  // presentation metadata, not graph identity.
  braidGraphLayout: BraidGraphLayoutDto | null;
  // Discriminated provenance. Null when the version has no braid
  // representation (classical prompt).
  braidAuthorship: BraidAuthorshipDto | null;
  // Convenience projection of `braidAuthorship`: the model id for "model"
  // authorships, the derivedFromModel for "manual" authorships (null if
  // unknown). Kept alongside the discriminated field so simple UI rows
  // don't have to branch for the common "show the model name" case.
  generatorModel: string | null;
  // Template variables referenced via `{{name}}` placeholders in
  // `sourcePrompt` and BRAID node labels. Empty list means the version uses
  // no substitution.
  variables: PromptVariableDto[];
  status: VersionStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface PromptVariableInput {
  name: string;
  description?: string | null;
  defaultValue?: string | null;
  required?: boolean;
}

export interface CreatePromptRequest {
  name: string;
  description?: string;
  taskType: TaskType;
  initialPrompt: string;
  variables?: PromptVariableInput[];
}

export interface CreateVersionRequest {
  sourcePrompt: string;
  name?: string;
  variables?: PromptVariableInput[];
}

export interface UpdateVersionRequest {
  name: string | null;
}

export interface PromoteVersionRequest {
  targetStatus: Exclude<VersionStatus, "draft">;
}

export type PromptListResponse = Paginated<PromptDto>;
export type VersionListResponse = Paginated<PromptVersionDto>;

// Variables diff projection. Variables are name-keyed, not position-
// keyed, so the diff is set-semantic: a variable rename is `removed`
// + `added`, not `changed`. `changed` rows surface when the same name
// has different description/defaultValue/required between base and
// target — UI renders those as a side-by-side cell with old/new.
export interface VersionVariableChangeDto {
  name: string;
  base: PromptVariableDto;
  target: PromptVariableDto;
}

export interface VersionVariablesDiffDto {
  added: PromptVariableDto[];
  removed: PromptVariableDto[];
  changed: VersionVariableChangeDto[];
  unchanged: PromptVariableDto[];
}

// Side-by-side comparison between two versions of the same prompt.
// `base` is conventionally the "older" or "left" side and `target`
// the "newer" or "right" side; the use case enforces both versions
// share the same prompt (and org) — comparing across prompts is not
// meaningful.
//
// Body and graph diffs are NOT pre-computed server-side: those are
// text artifacts the UI renders via Monaco's DiffEditor and a
// mermaid-text diff respectively. Variables diff IS pre-computed
// because the matching rule (name-based, set semantic) is non-trivial
// and must be deterministic across UI surfaces.
export interface VersionComparisonDto {
  base: PromptVersionDto;
  target: PromptVersionDto;
  variablesDiff: VersionVariablesDiffDto;
}
