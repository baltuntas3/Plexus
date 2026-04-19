import type { VersionStatus } from "@plexus/shared-types";
import type { PromptVersion } from "../entities/prompt-version.js";

export interface CreateVersionInput {
  promptId: string;
  version: string;
  classicalPrompt: string;
  name?: string | null;
}

export interface ListVersionsQuery {
  promptId: string;
  page: number;
  pageSize: number;
}

export interface VersionListResult {
  items: PromptVersion[];
  total: number;
}

export interface IPromptVersionRepository {
  create(input: CreateVersionInput): Promise<PromptVersion>;
  findById(id: string): Promise<PromptVersion | null>;
  findByPromptAndVersion(promptId: string, version: string): Promise<PromptVersion | null>;
  list(query: ListVersionsQuery): Promise<VersionListResult>;
  countByPrompt(promptId: string): Promise<number>;
  findCurrentByStatus(promptId: string, status: VersionStatus): Promise<PromptVersion | null>;
  updateStatus(id: string, status: VersionStatus): Promise<void>;
  // Updates the user-visible name. Pass null to clear it (reverts callers to
  // displaying the auto-generated `version` field).
  updateName(id: string, name: string | null): Promise<void>;
  setBraidGraph(id: string, braidGraph: string, generatorModel: string): Promise<void>;
  updateBraidGraph(id: string, braidGraph: string): Promise<void>;
}
