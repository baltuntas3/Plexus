// Arithmetic mean of a numeric sample. Empty input returns 0 — callers in
// the benchmark pipeline group rows into buckets that may have no graded
// values yet, and treating "no data" as 0 lets aggregation continue without
// special-casing every reader.
export const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
