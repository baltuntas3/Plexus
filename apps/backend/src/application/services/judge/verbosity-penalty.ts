// Verbosity penalty: multiplicative factor in [0, MAX_PENALTY] applied to the
// raw rubric score. Answers up to FREE_RATIOx the baseline length are free;
// beyond CAP_RATIOx they hit the cap. Linear ramp in between.
//
// Caller:
// - Per-row, reference-based: the judge applies the penalty immediately using
//   the test case's expected output as the length baseline (preserves backward
//   behaviour - the penalty is baked into `finalScore` during grading).

const FREE_RATIO = 2;
const CAP_RATIO = 4;
const MAX_PENALTY = 0.5;

const BREVITY_FREE_RATIO = 0.5;
const BREVITY_CAP_RATIO = 0.25;

export const computeVerbosityPenalty = (
  candidate: string,
  reference: string | undefined,
): number => {
  const candidateLength = normaliseLength(candidate);
  const referenceLength = normaliseLength(reference);
  if (referenceLength <= 0) return 0;
  return clampPenalty(
    rampedPenalty(candidateLength / referenceLength) +
      computeBrevityPenaltyAgainstBaseline(candidateLength, referenceLength),
  );
};

export const computeVerbosityPenaltyAgainstBaseline = (
  candidateLength: number,
  baselineLength: number,
  maxPenalty: number = MAX_PENALTY,
): number => {
  if (baselineLength <= 0) return 0;
  return rampedPenalty(candidateLength / baselineLength, maxPenalty);
};

const rampedPenalty = (ratio: number, cap: number = MAX_PENALTY): number => {
  if (ratio <= FREE_RATIO) return 0;
  if (ratio >= CAP_RATIO) return cap;
  const t = (ratio - FREE_RATIO) / (CAP_RATIO - FREE_RATIO);
  return t * cap;
};

export const computeBrevityPenaltyAgainstBaseline = (
  candidateLength: number,
  baselineLength: number,
  maxPenalty: number = MAX_PENALTY,
): number => {
  if (baselineLength <= 0) return 0;
  const ratio = candidateLength / baselineLength;
  if (ratio >= BREVITY_FREE_RATIO) return 0;
  if (ratio <= BREVITY_CAP_RATIO) return maxPenalty;
  const t = (BREVITY_FREE_RATIO - ratio) / (BREVITY_FREE_RATIO - BREVITY_CAP_RATIO);
  return t * maxPenalty;
};

export const combineLengthPenalties = (...penalties: number[]): number =>
  clampPenalty(penalties.reduce((sum, penalty) => sum + penalty, 0));

const clampPenalty = (value: number): number => Math.max(0, Math.min(1, value));

const normaliseLength = (
  text: string | undefined,
): number => {
  if (!text) return 0;
  return estimateTokenCount(text);
};

// Lightweight tokenizer proxy for cases where provider token usage is not
// available. Counting lexical chunks plus standalone symbols tracks "how much
// content was produced" much better than raw character length across languages.
const estimateTokenCount = (text: string): number => {
  const matches = text.match(/[\p{L}\p{N}]+(?:['_-][\p{L}\p{N}]+)*|[^\s]/gu);
  return matches?.length ?? 0;
};
