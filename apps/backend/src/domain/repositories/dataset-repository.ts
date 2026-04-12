import type { TaskType } from "@plexus/shared-types";
import type { Dataset, TestCase } from "../entities/dataset.js";

export interface CreateDatasetInput {
  name: string;
  description: string;
  taskType: TaskType;
  ownerId: string;
  testCases: TestCase[];
}

export interface ListDatasetsQuery {
  ownerId: string;
  page: number;
  pageSize: number;
  search?: string;
}

export interface DatasetListResult {
  items: Dataset[];
  total: number;
}

export interface IDatasetRepository {
  create(input: CreateDatasetInput): Promise<Dataset>;
  findById(id: string): Promise<Dataset | null>;
  list(query: ListDatasetsQuery): Promise<DatasetListResult>;
  delete(id: string): Promise<void>;
  addTestCases(id: string, cases: TestCase[]): Promise<Dataset | null>;
  removeTestCase(id: string, testCaseId: string): Promise<Dataset | null>;
}
