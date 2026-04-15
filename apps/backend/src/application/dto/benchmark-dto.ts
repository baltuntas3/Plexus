import { z } from "zod";

export const createBenchmarkSchema = z.object({
  name: z.string().min(1).max(120),
  promptVersionIds: z.array(z.string().min(1)).min(1),
  solverModels: z.array(z.string().min(1)).min(1),
  judgeModel: z.string().min(1),
  generatorModel: z.string().min(1),
  testCount: z.coerce.number().int().min(1).max(100),
  concurrency: z.coerce.number().int().min(1).max(16).optional().default(2),
});
export type CreateBenchmarkDto = z.infer<typeof createBenchmarkSchema>;

export const updateTestCasesSchema = z.object({
  updates: z.array(
    z.object({
      id: z.string().min(1),
      expectedOutput: z.string().nullable(),
    }),
  ),
});
export type UpdateTestCasesDto = z.infer<typeof updateTestCasesSchema>;

export const listBenchmarksQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListBenchmarksQueryDto = z.infer<typeof listBenchmarksQuerySchema>;
