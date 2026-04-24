import { ValidationError } from "../errors/domain-error.js";

// Deterministic 31-bit seed for test-case generation and solver sampling.
// Bounded to [0, 2^31) so a JS `number & 0x7fffffff` round-trip is identity
// and downstream hashing stays branch-free.
export class BenchmarkSeed {
  private constructor(private readonly value: number) {}

  static of(raw: number): BenchmarkSeed {
    if (!Number.isInteger(raw) || raw < 0 || raw > 0x7fffffff) {
      throw ValidationError(
        `Benchmark seed must be an integer in [0, 2^31), got ${raw}`,
      );
    }
    return new BenchmarkSeed(raw);
  }

  static random(): BenchmarkSeed {
    return new BenchmarkSeed(Math.floor(Math.random() * 0x7fffffff));
  }

  toNumber(): number {
    return this.value;
  }
}
