import { ValidationError } from "../errors/domain-error.js";

// Canonical label format ("v1", "v2", ...) for prompt versions. Acts as a
// produce/parse guard so a raw string from HTTP or the DB cannot silently
// flow into aggregate state with a malformed shape, and so the "v{n}" format
// lives in exactly one place instead of being reproduced with string
// concatenation at every call site.
export class VersionLabel {
  private constructor(private readonly value: string) {}

  static fromSequence(counter: number): VersionLabel {
    if (!Number.isInteger(counter) || counter < 1) {
      throw ValidationError(`Version sequence must be a positive integer, got ${counter}`);
    }
    return new VersionLabel(`v${counter}`);
  }

  static parse(raw: string): VersionLabel {
    if (!/^v\d+$/.test(raw)) {
      throw ValidationError(`Invalid version label: ${raw}`);
    }
    return new VersionLabel(raw);
  }

  toString(): string {
    return this.value;
  }

  equals(other: VersionLabel): boolean {
    return this.value === other.value;
  }
}
