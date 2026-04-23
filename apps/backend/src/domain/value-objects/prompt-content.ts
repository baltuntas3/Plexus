import { ValidationError } from "../errors/domain-error.js";

export class PromptContent {
  private constructor(private readonly value: string) {}

  static create(raw: string): PromptContent {
    const normalized = raw.trim();
    if (normalized.length === 0) {
      throw ValidationError("Source prompt is empty");
    }
    return new PromptContent(normalized);
  }

  toString(): string {
    return this.value;
  }
}
