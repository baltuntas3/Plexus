import { Benchmark } from "../../domain/entities/benchmark.js";
import { BenchmarkAggregateStaleError } from "../../domain/errors/domain-error.js";
import type { IBenchmarkRepository } from "../../domain/repositories/benchmark-repository.js";

// Mirrors the Mongo benchmark repo's snapshot/markPersisted protocol: save
// takes a snapshot, checks the expected revision against what the store
// has, persists the new primitives, and advances the aggregate's cursor.
// Provides the seam used by the benchmark query service fake to serve
// summaries off the same state.
export class InMemoryBenchmarkRepository implements IBenchmarkRepository {
  private readonly benchmarks = new Map<string, Benchmark>();
  private readonly storedRevisions = new Map<string, number>();

  async findById(id: string): Promise<Benchmark | null> {
    return this.benchmarks.get(id) ?? null;
  }

  async findInOrganization(
    id: string,
    organizationId: string,
  ): Promise<Benchmark | null> {
    const benchmark = this.benchmarks.get(id);
    if (!benchmark || benchmark.organizationId !== organizationId) return null;
    return benchmark;
  }

  async save(benchmark: Benchmark): Promise<void> {
    const { primitives, expectedRevision } = benchmark.toSnapshot();
    const stored = this.storedRevisions.get(benchmark.id);
    if (stored !== undefined && stored !== expectedRevision) {
      throw BenchmarkAggregateStaleError();
    }
    const hydrated = Benchmark.hydrate(primitives);
    this.benchmarks.set(benchmark.id, hydrated);
    this.storedRevisions.set(benchmark.id, primitives.revision);
    benchmark.markPersisted();
  }

  // Test helper — enumerate without the query projection. Production reads
  // go through IBenchmarkQueryService.
  allForOrganization(organizationId: string): Benchmark[] {
    return [...this.benchmarks.values()].filter(
      (b) => b.organizationId === organizationId,
    );
  }
}
