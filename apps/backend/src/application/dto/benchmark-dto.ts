import { z } from "zod";
import { TEST_CASE_CATEGORIES } from "../../domain/entities/benchmark.js";

const uniqueStringArray = (field: string, min = 1) =>
  z
    .array(z.string().min(1))
    .min(min)
    .refine((arr) => new Set(arr).size === arr.length, {
      message: `${field} must be unique`,
    });

// The public create-benchmark surface exposes only the four choices the
// caller actually needs to make. Judge ensemble, generator, test-generation
// mode, analysis model, repetitions, concurrency and seed are derived inside
// the use case so the simplest call still produces a fair, reproducible
// benchmark.
export const createBenchmarkSchema = z.object({
  name: z.string().min(1).max(120),
  promptVersionIds: uniqueStringArray("promptVersionIds"),
  solverModels: uniqueStringArray("solverModels"),
  testCount: z.coerce.number().int().min(1).max(100),
});
export type CreateBenchmarkDto = z.infer<typeof createBenchmarkSchema>;

export const updateTestCasesSchema = z.object({
  updates: z.array(
    z.object({
      id: z.string().min(1),
      input: z.string().min(1).optional(),
      expectedOutput: z.string().nullable(),
      category: z.enum(TEST_CASE_CATEGORIES).nullable().optional(),
    }),
  ),
  additions: z
    .array(
      z.object({
        input: z.string().min(1),
        expectedOutput: z.string().nullable(),
        category: z.enum(TEST_CASE_CATEGORIES).nullable().optional(),
      }),
    )
    .optional()
    .default([]),
});
export type UpdateTestCasesDto = z.infer<typeof updateTestCasesSchema>;

export const listBenchmarksQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListBenchmarksQueryDto = z.infer<typeof listBenchmarksQuerySchema>;
