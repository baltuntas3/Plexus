import { ValidationError } from "../errors/domain-error.js";

// Deterministic 31-bit seed for test-case generation and solver sampling.
// Bounded to [0, 2^31) so a JS `number & 0x7fffffff` round-trip is identity
// and downstream hashing stays branch-free. Modeled as a primitive int +
// boundary assertion rather than a wrapper class because consumers always
// hold the raw number — the wrapper would never travel.

export const randomBenchmarkSeed = (): number =>
  Math.floor(Math.random() * 0x7fffffff);

export const assertBenchmarkSeed = (raw: number): void => {
  if (!Number.isInteger(raw) || raw < 0 || raw > 0x7fffffff) {
    throw ValidationError(
      `Benchmark seed must be an integer in [0, 2^31), got ${raw}`,
    );
  }
};
