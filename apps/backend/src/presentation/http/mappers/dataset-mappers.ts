import type { DatasetDetailDto, DatasetDto, TestCaseDto } from "@plexus/shared-types";
import type { Dataset, TestCase } from "../../../domain/entities/dataset.js";

const toTestCaseDto = (tc: TestCase): TestCaseDto => ({
  id: tc.id,
  input: tc.input,
  expectedOutput: tc.expectedOutput,
  metadata: tc.metadata,
});

export const toDatasetDto = (dataset: Dataset): DatasetDto => ({
  id: dataset.id,
  name: dataset.name,
  description: dataset.description,
  taskType: dataset.taskType,
  ownerId: dataset.ownerId,
  testCaseCount: dataset.testCases.length,
  createdAt: dataset.createdAt.toISOString(),
  updatedAt: dataset.updatedAt.toISOString(),
});

export const toDatasetDetailDto = (dataset: Dataset): DatasetDetailDto => ({
  ...toDatasetDto(dataset),
  testCases: dataset.testCases.map(toTestCaseDto),
});
