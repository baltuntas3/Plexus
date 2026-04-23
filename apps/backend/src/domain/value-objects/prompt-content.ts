import { PromptSourceEmptyError } from "../errors/domain-error.js";

export class PromptContent {
  private constructor(private readonly value: string) {}

  static create(raw: string): PromptContent {
    const normalized = raw.trim();
    if (normalized.length === 0) {
      throw PromptSourceEmptyError();
    }
    return new PromptContent(normalized);
  }

  // Hydrate path: the string is already-persisted state that was validated at
  // creation time, so we skip re-validation. Bypassing `create` keeps load
  // from exploding when legacy data exists and preserves the invariant that
  // "hydrate reconstructs; create enforces".
  static fromPersistence(raw: string): PromptContent {
    return new PromptContent(raw);
  }

  toString(): string {
    return this.value;
  }
}
