import type { Benchmark } from "../../domain/entities/benchmark.js";
import type {
  BenchmarkListResult,
  BenchmarkStatusUpdate,
  CreateBenchmarkInput,
  IBenchmarkRepository,
  ListBenchmarksQuery,
} from "../../domain/repositories/benchmark-repository.js";
import type { BenchmarkProgress } from "../../domain/entities/benchmark.js";

export class InMemoryBenchmarkRepository implements IBenchmarkRepository {
  private readonly store = new Map<string, Benchmark>();
  private nextId = 1;

  async create(input: CreateBenchmarkInput): Promise<Benchmark> {
    const id = String(this.nextId++);
    const bm: Benchmark = {
      id,
      name: input.name,
      ownerId: input.ownerId,
      promptVersionIds: input.promptVersionIds,
      solverModels: input.solverModels,
      judgeModel: input.judgeModel,
      generatorModel: input.generatorModel,
      testCount: input.testCount,
      testCases: input.testCases,
      concurrency: input.concurrency,
      status: "draft",
      progress: { completed: 0, total: 0 },
      jobId: null,
      error: null,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
    };
    this.store.set(id, bm);
    return bm;
  }

  async findById(id: string): Promise<Benchmark | null> {
    return this.store.get(id) ?? null;
  }

  async list(query: ListBenchmarksQuery): Promise<BenchmarkListResult> {
    const items = [...this.store.values()].filter((b) => b.ownerId === query.ownerId);
    const start = (query.page - 1) * query.pageSize;
    return { items: items.slice(start, start + query.pageSize), total: items.length };
  }

  async updateStatus(id: string, update: BenchmarkStatusUpdate): Promise<void> {
    const bm = this.store.get(id);
    if (!bm) return;
    this.store.set(id, {
      ...bm,
      status: update.status,
      jobId: update.jobId !== undefined ? update.jobId : bm.jobId,
      error: update.error !== undefined ? update.error : bm.error,
      startedAt: update.startedAt !== undefined ? update.startedAt : bm.startedAt,
      completedAt:
        update.completedAt !== undefined ? update.completedAt : bm.completedAt,
    });
  }

  async updateProgress(id: string, progress: BenchmarkProgress): Promise<void> {
    const bm = this.store.get(id);
    if (!bm) return;
    this.store.set(id, { ...bm, progress });
  }

  async updateTestCases(
    id: string,
    updates: Array<{ id: string; expectedOutput: string | null }>,
  ): Promise<void> {
    const bm = this.store.get(id);
    if (!bm) return;
    const testCases = bm.testCases.map((tc) => {
      const u = updates.find((x) => x.id === tc.id);
      return u ? { ...tc, expectedOutput: u.expectedOutput } : tc;
    });
    this.store.set(id, { ...bm, testCases });
  }
}
