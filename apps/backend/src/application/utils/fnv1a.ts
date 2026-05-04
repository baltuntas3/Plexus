// FNV-1a 32-bit string hash with a configurable initial state. Same
// `(seed, str)` pair always returns the same 32-bit unsigned integer —
// used wherever we need a deterministic numeric tag derived from a string
// (bootstrap CI seeding, per-cell solver seed, batched-judge label seed).
// Callers that need narrower outputs (e.g. 31-bit benchmark seeds) mask
// the return value at the call site so the hash function itself stays a
// pure 32-bit primitive.
export const fnv1a = (seed: number, str: string): number => {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (h ^ str.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
};
