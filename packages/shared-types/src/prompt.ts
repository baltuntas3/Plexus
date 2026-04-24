import type { ISODateString, Paginated } from "./common.js";

export const TASK_TYPES = ["general", "math", "creative", "instruction-following", "code"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const VERSION_STATUSES = ["draft", "staging", "production"] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

export interface PromptDto {
  id: string;
  name: string;
  description: string;
  taskType: TaskType;
  ownerId: string;
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
  braidGraph: string | null;
  // Discriminated provenance. Null when the version has no braid
  // representation (classical prompt).
  braidAuthorship: BraidAuthorshipDto | null;
  // Convenience projection of `braidAuthorship`: the model id for "model"
  // authorships, the derivedFromModel for "manual" authorships (null if
  // unknown). Kept alongside the discriminated field so simple UI rows
  // don't have to branch for the common "show the model name" case.
  generatorModel: string | null;
  status: VersionStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface CreatePromptRequest {
  name: string;
  description?: string;
  taskType: TaskType;
  initialPrompt: string;
}

export interface CreateVersionRequest {
  sourcePrompt: string;
  name?: string;
}

export interface UpdateVersionRequest {
  name: string | null;
}

export interface PromoteVersionRequest {
  targetStatus: Exclude<VersionStatus, "draft">;
}

export type PromptListResponse = Paginated<PromptDto>;
export type VersionListResponse = Paginated<PromptVersionDto>;
