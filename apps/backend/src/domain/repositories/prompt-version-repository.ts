import type { VersionStatus } from "@plexus/shared-types";
import type { PromptVersion } from "../entities/prompt-version.js";

export interface CreateVersionInput {
  promptId: string;
  version: string;
  classicalPrompt: string;
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
  setBraidGraph(id: string, braidGraph: string, generatorModel: string): Promise<void>;
}
