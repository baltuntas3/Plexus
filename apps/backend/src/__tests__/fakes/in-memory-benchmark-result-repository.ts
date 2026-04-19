import {
  benchmarkResultKey,
  type BenchmarkResult,
} from "../../domain/entities/benchmark-result.js";
import type {
  IBenchmarkResultRepository,
  UpdateScoresInput,
  UpsertBenchmarkResultInput,
} from "../../domain/repositories/benchmark-result-repository.js";

export class InMemoryBenchmarkResultRepository implements IBenchmarkResultRepository {
  private readonly store = new Map<string, BenchmarkResult>();
  private readonly byId = new Map<string, string>();
  private nextId = 1;

  async upsert(input: UpsertBenchmarkResultInput): Promise<BenchmarkResult> {
    const key = this.compositeKey(input);
    const existing = this.store.get(key);
    const id = existing?.id ?? String(this.nextId++);
    const row: BenchmarkResult = {
      ...input,
      id,
      createdAt: existing?.createdAt ?? new Date(),
    };
    this.store.set(key, row);
    this.byId.set(id, key);
    return row;
  }

  async listByBenchmark(benchmarkId: string): Promise<BenchmarkResult[]> {
    return [...this.store.values()].filter((r) => r.benchmarkId === benchmarkId);
  }

  async findExistingKeys(benchmarkId: string): Promise<Set<string>> {
    const out = new Set<string>();
    for (const r of this.store.values()) {
      if (r.benchmarkId !== benchmarkId) continue;
      out.add(benchmarkResultKey(r.testCaseId, r.promptVersionId, r.solverModel, r.runIndex));
    }
    return out;
  }

  async updateScores(input: UpdateScoresInput): Promise<void> {
    const key = this.byId.get(input.id);
    if (!key) return;
    const row = this.store.get(key);
    if (!row) return;
    this.store.set(key, {
      ...row,
      verbosityPenalty: input.verbosityPenalty,
      finalScore: input.finalScore,
    });
  }

  private compositeKey(
    input: Pick<
      UpsertBenchmarkResultInput,
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
