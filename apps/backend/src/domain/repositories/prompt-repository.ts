import type { TaskType } from "@plexus/shared-types";
import type { Prompt } from "../entities/prompt.js";

export interface CreatePromptInput {
  name: string;
  description: string;
  taskType: TaskType;
  ownerId: string;
}

export interface ListPromptsQuery {
  ownerId: string;
  page: number;
  pageSize: number;
  search?: string;
}

export interface PromptListResult {
  items: Prompt[];
  total: number;
}

export interface IPromptRepository {
  create(input: CreatePromptInput): Promise<Prompt>;
  findById(id: string): Promise<Prompt | null>;
  list(query: ListPromptsQuery): Promise<PromptListResult>;
  setProductionVersion(promptId: string, version: string | null): Promise<void>;
}
