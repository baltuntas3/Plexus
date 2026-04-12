import { z } from "zod";
import { TASK_TYPES } from "@plexus/shared-types";

export const createTestCaseSchema = z.object({
  input: z.string().min(1).max(10_000),
  expectedOutput: z.string().max(10_000).nullable().optional().default(null),
  metadata: z.record(z.unknown()).optional().default({}),
});
export type CreateTestCaseDto = z.infer<typeof createTestCaseSchema>;

export const createDatasetSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional().default(""),
  taskType: z.enum(TASK_TYPES),
  testCases: z.array(createTestCaseSchema).optional().default([]),
});
export type CreateDatasetDto = z.infer<typeof createDatasetSchema>;

export const addTestCasesSchema = z.object({
  testCases: z.array(createTestCaseSchema).min(1),
});
export type AddTestCasesDto = z.infer<typeof addTestCasesSchema>;

export const generateDatasetSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional().default(""),
  taskType: z.enum(TASK_TYPES),
  topic: z.string().min(1).max(500),
  count: z.coerce.number().int().min(1).max(200),
  model: z.string().min(1),
});
export type GenerateDatasetDto = z.infer<typeof generateDatasetSchema>;

export const listDatasetsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
});
export type ListDatasetsQueryDto = z.infer<typeof listDatasetsQuerySchema>;
