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
