// Deterministic Fisher-Yates shuffle driven by a 32-bit xorshift PRNG.
// Same (items, seed) pair always returns the same permutation — used where
// reproducibility matters (judge label permutation, benchmark execution
// order under budget caps, etc.).
export const seededShuffle = <T>(items: readonly T[], seed: number): T[] => {
  const out = [...items];
  let state = (seed >>> 0) || 1;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    const j = state % (i + 1);
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
};
