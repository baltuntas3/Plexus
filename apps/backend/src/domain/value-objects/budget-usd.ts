import { ValidationError } from "../errors/domain-error.js";

// Money bounded to positive, finite values. Zero is allowed only when the
// user explicitly opts out of a cap (we model "no cap" as `null`, never as
// `0`, so this VO refuses 0 to keep "how much are we allowed to spend?"
// semantically honest).
export class BudgetUsd {
  private constructor(private readonly amount: number) {}

  static of(amount: number): BudgetUsd {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw ValidationError(`Budget must be a positive finite number, got ${amount}`);
    }
    return new BudgetUsd(amount);
  }

  toNumber(): number {
    return this.amount;
  }

  includes(cost: number): boolean {
    return cost <= this.amount;
  }
}
