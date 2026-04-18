// Verbosity penalty: multiplicative factor in [0, MAX_PENALTY] applied to the
// raw rubric score. Answers up to FREE_RATIO× the baseline length are free;
// beyond CAP_RATIO× they hit the cap. Linear ramp in between.
//
// Two callers:
// - Per-row, reference-based: the judge applies the penalty immediately using
//   the test case's expected output as the length baseline (preserves backward
//   behaviour — the penalty is baked into `finalScore` during grading).
// - Post-run, reference-free: the runner computes the median candidate length
//   across all completed rows in a benchmark and applies the same ramp using
//   that median as the baseline. This closes the asymmetry where reference-
//   less test cases were never penalised for verbosity.

const FREE_RATIO = 2;
const CAP_RATIO = 4;
const MAX_PENALTY = 0.5;

export const computeVerbosityPenalty = (
  candidate: string,
  reference: string | undefined,
): number => {
  if (!reference || reference.length === 0) return 0;
  return rampedPenalty(candidate.length / reference.length);
};

export const computeVerbosityPenaltyAgainstBaseline = (
  candidateLength: number,
  baselineLength: number,
): number => {
  if (baselineLength <= 0) return 0;
  return rampedPenalty(candidateLength / baselineLength);
};

const rampedPenalty = (ratio: number): number => {
  if (ratio <= FREE_RATIO) return 0;
  if (ratio >= CAP_RATIO) return MAX_PENALTY;
  const t = (ratio - FREE_RATIO) / (CAP_RATIO - FREE_RATIO);
  return t * MAX_PENALTY;
};
