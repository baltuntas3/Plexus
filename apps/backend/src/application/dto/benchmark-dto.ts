import { z } from "zod";
import { TEST_CASE_CATEGORIES } from "@plexus/shared-types";

const uniqueStringArray = (field: string, min = 1) =>
  z
    .array(z.string().min(1))
    .min(min)
    .refine((arr) => new Set(arr).size === arr.length, {
      message: `${field} must be unique`,
    });

// The public create-benchmark surface exposes four required choices (name,
// versions, solvers, testCount). Judge ensemble, generator model, generation
// mode, seed, concurrency, and cell timeout are all derived server-side so
// the simplest call still produces a fair, reproducible benchmark.
//
// `repetitions` and `budgetUsd` stay overridable so cost-control scenarios
// (and the budget-gate tests) can dial the run up or down without forking
// the use case.
export const createBenchmarkSchema = z.object({
  name: z.string().min(1).max(120),
  promptVersionIds: uniqueStringArray("promptVersionIds"),
  solverModels: uniqueStringArray("solverModels"),
  testCount: z.coerce.number().int().min(1).max(50),
  repetitions: z.coerce.number().int().min(1).max(10).optional(),
  budgetUsd: z.coerce.number().min(0.01).max(50).optional(),
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
  // Optional filter: only return benchmarks whose `promptVersionIds`
  // array contains this id. Used by the Evaluation tab to show "past
  // evaluations of this version" without scanning every benchmark in
  // the org.
  promptVersionId: z.string().min(1).optional(),
});
export type ListBenchmarksQueryDto = z.infer<typeof listBenchmarksQuerySchema>;
