import { Benchmark } from "../../domain/entities/benchmark.js";
import { BenchmarkAggregateStaleError } from "../../domain/errors/domain-error.js";
import type { IBenchmarkRepository } from "../../domain/repositories/benchmark-repository.js";

// Mirrors the Mongo benchmark repo's snapshot/commit protocol: save takes a
// snapshot, checks the expected revision against what the store has,
// advances it, then commits the aggregate. Provides the seam used by the
// benchmark query service fake to serve summaries off the same state.
export class InMemoryBenchmarkRepository implements IBenchmarkRepository {
  private readonly benchmarks = new Map<string, Benchmark>();
  private readonly storedRevisions = new Map<string, number>();

  async findById(id: string): Promise<Benchmark | null> {
    return this.benchmarks.get(id) ?? null;
  }

  async findOwnedById(id: string, ownerId: string): Promise<Benchmark | null> {
    const benchmark = this.benchmarks.get(id);
    if (!benchmark || benchmark.ownerId !== ownerId) return null;
    return benchmark;
  }

  async save(benchmark: Benchmark): Promise<void> {
    const snapshot = benchmark.toSnapshot();
    const stored = this.storedRevisions.get(benchmark.id);
    if (stored !== undefined && stored !== snapshot.expectedRevision) {
      throw BenchmarkAggregateStaleError();
    }
    const hydrated = Benchmark.hydrate(snapshot.state);
    this.benchmarks.set(benchmark.id, hydrated);
    this.storedRevisions.set(benchmark.id, snapshot.nextRevision);
    benchmark.commit(snapshot);
  }

  // Test helper — enumerate without the query projection. Production reads
  // go through IBenchmarkQueryService.
  allForOwner(ownerId: string): Benchmark[] {
    return [...this.benchmarks.values()].filter((b) => b.ownerId === ownerId);
  }
}
