import { z } from "zod";
import { TEST_CASE_CATEGORIES } from "../../domain/entities/benchmark.js";

const uniqueStringArray = (field: string, min = 1) =>
  z
    .array(z.string().min(1))
    .min(min)
    .refine((arr) => new Set(arr).size === arr.length, {
      message: `${field} must be unique`,
    });

// The public create-benchmark surface exposes four required choices (name,
// versions, solvers, testCount). Everything else is derived inside the use
// case so the simplest call still produces a fair, reproducible benchmark.
//
// Advanced overrides are optional: callers who need reproducibility across
// runs pass an explicit `seed`, cost control can dial `judgeCount` or
// `repetitions` down, and explicit `testGenerationMode` bypasses the
// automatic single-vs-multi-version heuristic. All overrides are validated
// against the same bounds the defaults respect so the simple surface
// remains the low-ceiling default rather than being silently wrong.
export const createBenchmarkSchema = z.object({
  name: z.string().min(1).max(120),
  promptVersionIds: uniqueStringArray("promptVersionIds"),
  solverModels: uniqueStringArray("solverModels"),
  testCount: z.coerce.number().int().min(1).max(100),
  seed: z.coerce.number().int().min(0).max(0x7fffffff).optional(),
  judgeCount: z.coerce.number().int().min(1).max(5).optional(),
  repetitions: z.coerce.number().int().min(1).max(10).optional(),
  solverTemperature: z.coerce.number().min(0).max(2).optional(),
  concurrency: z.coerce.number().int().min(1).max(16).optional(),
  cellTimeoutMs: z.coerce.number().int().min(1000).max(600_000).optional(),
  budgetUsd: z.coerce.number().min(0.01).max(1000).optional(),
  testGenerationMode: z.enum(["shared-core", "diff-seeking", "hybrid"]).optional(),
  generatorModel: z.string().min(1).optional(),
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
