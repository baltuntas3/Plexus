// Performance-per-Dollar metric (BRAID paper, Amcalar & Cinar 2025, eq. 4).
//
//                  accuracy / cost
//   PPD = ─────────────────────────────────
//          accuracy_baseline / cost_baseline
//
// PPD > 1 means the candidate setup gives more accuracy per dollar than the
// baseline (typically: classic prompt + the strongest single solver model).
// PPD < 1 means the candidate is less efficient. PPD = 1 means parity.
//
// Both `accuracy` arguments are expected in [0, 1] (the JudgeScore.finalScore
// shape). Costs are USD totals across all test cases for that candidate.

export interface PPDInput {
  accuracy: number;
  costUsd: number;
}

export class PPD {
  private constructor(
    public readonly value: number,
    public readonly candidate: PPDInput,
    public readonly baseline: PPDInput,
  ) {}

  static compute(candidate: PPDInput, baseline: PPDInput): PPD {
    assertAccuracy("candidate", candidate.accuracy);
    assertAccuracy("baseline", baseline.accuracy);
    assertNonNegative("candidate.costUsd", candidate.costUsd);
    assertNonNegative("baseline.costUsd", baseline.costUsd);

    if (baseline.costUsd === 0) {
      throw new RangeError("PPD baseline.costUsd must be > 0");
    }
    if (baseline.accuracy === 0) {
      throw new RangeError("PPD baseline.accuracy must be > 0");
    }
    if (candidate.costUsd === 0) {
      // Free candidate with any positive accuracy is "infinitely" efficient.
      // Caller should treat this as a special case; we surface +Infinity rather
      // than a misleading finite number.
      return new PPD(Number.POSITIVE_INFINITY, candidate, baseline);
    }

    const candidateRatio = candidate.accuracy / candidate.costUsd;
    const baselineRatio = baseline.accuracy / baseline.costUsd;
    return new PPD(candidateRatio / baselineRatio, candidate, baseline);
  }

  // Multiplicative speedup the candidate gives over the baseline. Equal to
  // `value` but exposed under the user-facing name from the paper ("Nx
  // savings").
  get savingsMultiplier(): number {
    return this.value;
  }

  get isMoreEfficient(): boolean {
    return this.value > 1;
  }
}

const assertAccuracy = (field: string, value: number): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${field} accuracy must be in [0,1], got ${value}`);
  }
};

const assertNonNegative = (field: string, value: number): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative finite number, got ${value}`);
  }
};
