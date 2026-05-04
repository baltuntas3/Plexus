import { ValidationError } from "../errors/domain-error.js";

// Money bounded to positive, finite values. Zero is allowed only when the
// user explicitly opts out of a cap (we model "no cap" as `null`, never as
// `0`, so this validator refuses 0 to keep "how much are we allowed to
// spend?" semantically honest). Throws at the aggregate boundary; callers
// continue using the raw number directly so there is one source of truth.
export const assertBudgetUsd = (amount: number): void => {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw ValidationError(`Budget must be a positive finite number, got ${amount}`);
  }
};
