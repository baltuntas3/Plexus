import type { PromptVersionSummary } from "../../application/queries/prompt-query-service.js";
import type { BenchmarkTestCase } from "../entities/benchmark.js";
import {
  BenchmarkInvalidRepetitionsError,
  BenchmarkMatrixEmptyError,
  BenchmarkNoJudgesError,
} from "../errors/domain-error.js";

// A benchmark's execution grid: every (testCase × promptVersion ×
// solverModel × runIndex) tuple that needs a result row. Modeled as a
// domain VO so the "not empty", "repetitions >= 1", "at least one judge"
// preconditions surface as typed errors before the runner touches any
// provider, and so callers that walk the grid do not each have to reimplement
// the quadruple nested loop.

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
  judgeModels: readonly string[];
  repetitions: number;
}

export class BenchmarkMatrix {
  private constructor(private readonly cellsList: readonly MatrixCell[]) {}

  static build(input: BuildMatrixInput): BenchmarkMatrix {
    if (input.testCases.length === 0) {
      throw BenchmarkMatrixEmptyError();
    }
    if (input.judgeModels.length === 0) {
      throw BenchmarkNoJudgesError();
    }
    if (input.repetitions < 1) {
      throw BenchmarkInvalidRepetitionsError();
    }

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

  get size(): number {
    return this.cellsList.length;
  }
}
