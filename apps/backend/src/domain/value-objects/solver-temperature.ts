import { ValidationError } from "../errors/domain-error.js";

// Temperature range accepted across current provider APIs (OpenAI/Groq:
// 0..2, Anthropic: 0..1). Clamping at 2 is the conservative superset; the
// provider normalizes further when it matters.
export class SolverTemperature {
  private constructor(private readonly value: number) {}

  static of(raw: number): SolverTemperature {
    if (!Number.isFinite(raw) || raw < 0 || raw > 2) {
      throw ValidationError(
        `Solver temperature must be a finite number in [0, 2], got ${raw}`,
      );
    }
    return new SolverTemperature(raw);
  }

  toNumber(): number {
    return this.value;
  }
}
