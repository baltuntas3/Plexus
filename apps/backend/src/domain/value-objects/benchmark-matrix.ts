import type { PromptVersionSummary } from "../../application/queries/prompt-query-service.js";
import type { BenchmarkTestCase } from "../entities/benchmark.js";
import { BenchmarkMatrixEmptyError } from "../errors/domain-error.js";

// A benchmark's execution grid: every (testCase × promptVersion ×
// solverModel × runIndex) tuple that needs a result row. Modeled as a
// domain VO so callers that walk the grid don't each reimplement the
// quadruple nested loop.
//
// Aggregate-level preconditions ("no judges", "repetitions >= 1",
// "test cases present") are enforced once on Benchmark.create and again
// at run-time by Benchmark.assertRunnable; the matrix only guards the
// one invariant that depends on the *cartesian product* itself —
// versions/solvers/testCases combining to zero cells.

export interface MatrixCell {
  testCase: BenchmarkTestCase;
  version: PromptVersionSummary;
  solverModel: string;
  runIndex: number;
}

export interface BuildMatrixInput {
  testCases: readonly BenchmarkTestCase[];
  versions: readonly PromptVersionSummary[];
  solverModels: readonly string[];
  repetitions: number;
}

export class BenchmarkMatrix {
  private constructor(private readonly cellsList: readonly MatrixCell[]) {}

  static build(input: BuildMatrixInput): BenchmarkMatrix {
    const cells: MatrixCell[] = [];
    for (const testCase of input.testCases) {
      for (const version of input.versions) {
        for (const solverModel of input.solverModels) {
          for (let runIndex = 0; runIndex < input.repetitions; runIndex += 1) {
            cells.push({ testCase, version, solverModel, runIndex });
          }
        }
      }
    }
    if (cells.length === 0) {
      throw BenchmarkMatrixEmptyError();
    }
    return new BenchmarkMatrix(cells);
  }

  get cells(): readonly MatrixCell[] {
    return this.cellsList;
  }
}
