import {
  benchmarkResultKey,
  type BenchmarkResult,
  type UpsertableBenchmarkResult,
} from "../../domain/entities/benchmark-result.js";
import type { IBenchmarkResultRepository } from "../../domain/repositories/benchmark-result-repository.js";

export class InMemoryBenchmarkResultRepository implements IBenchmarkResultRepository {
  private readonly store = new Map<string, BenchmarkResult>();
  private nextId = 1;

  async upsert(input: UpsertableBenchmarkResult): Promise<BenchmarkResult> {
    const key = this.compositeKey(input);
    const existing = this.store.get(key);
    const id = existing?.id ?? String(this.nextId++);
    const row: BenchmarkResult = {
      ...input,
      id,
      createdAt: existing?.createdAt ?? new Date(),
    };
    this.store.set(key, row);
    return row;
  }

  async listByBenchmark(benchmarkId: string): Promise<BenchmarkResult[]> {
    return [...this.store.values()].filter((r) => r.benchmarkId === benchmarkId);
  }

  private compositeKey(
    input: Pick<
      UpsertableBenchmarkResult,
      "benchmarkId" | "testCaseId" | "promptVersionId" | "solverModel" | "runIndex"
    >,
  ): string {
    return `${input.benchmarkId}::${benchmarkResultKey(
      input.testCaseId,
      input.promptVersionId,
      input.solverModel,
      input.runIndex,
    )}`;
  }
}
