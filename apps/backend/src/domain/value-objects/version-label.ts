import { ValidationError } from "../errors/domain-error.js";

// Canonical version-label format. Exported so application-layer Zod
// schemas can validate the same shape at the HTTP boundary without
// duplicating the regex — boundary and domain stay in lock-step if the
// format ever changes (e.g. `v1.2` semver).
export const VERSION_LABEL_PATTERN = /^v\d+$/;

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
    if (!VERSION_LABEL_PATTERN.test(raw)) {
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
