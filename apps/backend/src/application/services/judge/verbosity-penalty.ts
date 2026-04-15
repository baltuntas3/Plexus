// Verbosity penalty: multiplicative factor in [0, MAX_PENALTY] applied to the
// raw rubric score. Answers up to 2x reference length are free; beyond 4x they
// hit the cap. Linear ramp in between. Without a reference, no penalty applies.

const FREE_RATIO = 2;
const CAP_RATIO = 4;
const MAX_PENALTY = 0.5;

export const computeVerbosityPenalty = (
  candidate: string,
  reference: string | undefined,
): number => {
  if (!reference || reference.length === 0) return 0;
  const ratio = candidate.length / reference.length;
  if (ratio <= FREE_RATIO) return 0;
  if (ratio >= CAP_RATIO) return MAX_PENALTY;
  const t = (ratio - FREE_RATIO) / (CAP_RATIO - FREE_RATIO);
  return t * MAX_PENALTY;
};
