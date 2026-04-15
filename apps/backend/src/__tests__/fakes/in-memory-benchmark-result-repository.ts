import {
  benchmarkResultKey,
  type BenchmarkResult,
} from "../../domain/entities/benchmark-result.js";
import type {
  IBenchmarkResultRepository,
  UpsertBenchmarkResultInput,
} from "../../domain/repositories/benchmark-result-repository.js";

export class InMemoryBenchmarkResultRepository implements IBenchmarkResultRepository {
  private readonly store = new Map<string, BenchmarkResult>();
  private nextId = 1;

  async upsert(input: UpsertBenchmarkResultInput): Promise<BenchmarkResult> {
    const key = this.compositeKey(input);
    const existing = this.store.get(key);
    const row: BenchmarkResult = {
      ...input,
      id: existing?.id ?? String(this.nextId++),
      createdAt: existing?.createdAt ?? new Date(),
    };
    this.store.set(key, row);
    return row;
  }

  async listByBenchmark(benchmarkId: string): Promise<BenchmarkResult[]> {
    return [...this.store.values()].filter((r) => r.benchmarkId === benchmarkId);
  }

  async findCompletedKeys(benchmarkId: string): Promise<Set<string>> {
    const out = new Set<string>();
    for (const r of this.store.values()) {
      if (r.benchmarkId !== benchmarkId) continue;
      if (r.status !== "completed") continue;
      out.add(benchmarkResultKey(r.testCaseId, r.promptVersionId, r.solverModel));
    }
    return out;
  }

  private compositeKey(
    input: Pick<UpsertBenchmarkResultInput, "benchmarkId" | "testCaseId" | "promptVersionId" | "solverModel">,
  ): string {
    return `${input.benchmarkId}::${benchmarkResultKey(
      input.testCaseId,
      input.promptVersionId,
      input.solverModel,
    )}`;
  }
}
