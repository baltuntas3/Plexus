import type { ISODateString, Paginated } from "./common.js";
import type { TaskType } from "./prompt.js";

export interface TestCaseDto {
  id: string;
  input: string;
  expectedOutput: string | null;
  metadata: Record<string, unknown>;
}

export interface DatasetDto {
  id: string;
  name: string;
  description: string;
  taskType: TaskType;
  ownerId: string;
  testCaseCount: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface DatasetDetailDto extends DatasetDto {
  testCases: TestCaseDto[];
}

export interface CreateDatasetRequest {
  name: string;
  description?: string;
  taskType: TaskType;
  testCases?: CreateTestCaseInput[];
}

export interface CreateTestCaseInput {
  input: string;
  expectedOutput?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AddTestCasesRequest {
  testCases: CreateTestCaseInput[];
}

export type DatasetListResponse = Paginated<DatasetDto>;
