import { ValidationError } from "../errors/domain-error.js";

// Variable name format: must start with letter or underscore, then letters,
// digits, underscores. Mirrors the `{{name}}` placeholder grammar parsed by
// `extractVariableReferences` so the two cannot drift apart.
const NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_DEFAULT_VALUE_LENGTH = 2000;

export interface PromptVariableSnapshot {
  name: string;
  description: string | null;
  defaultValue: string | null;
  required: boolean;
}

// Single template variable definition on a PromptVersion. Only string-typed
// substitution is supported in v1 (other types added when a real need shows up
// — YAGNI). Validation lives here so an invalid name cannot enter the
// aggregate state.
export class PromptVariable {
  private constructor(
    private readonly _name: string,
    private readonly _description: string | null,
    private readonly _defaultValue: string | null,
    private readonly _required: boolean,
  ) {}

  static create(params: {
    name: string;
    description?: string | null;
    defaultValue?: string | null;
    required?: boolean;
  }): PromptVariable {
    const name = params.name.trim();
    if (!NAME_PATTERN.test(name)) {
      throw ValidationError(
        `Variable name "${params.name}" is invalid; must match ${NAME_PATTERN}`,
      );
    }
    if (name.length > MAX_NAME_LENGTH) {
      throw ValidationError(
        `Variable name "${name}" exceeds ${MAX_NAME_LENGTH} chars`,
      );
    }
    const description = normalizeOptional(params.description ?? null, MAX_DESCRIPTION_LENGTH, "description");
    const defaultValue = normalizeOptional(params.defaultValue ?? null, MAX_DEFAULT_VALUE_LENGTH, "defaultValue");
    return new PromptVariable(name, description, defaultValue, params.required ?? false);
  }

  static fromSnapshot(snapshot: PromptVariableSnapshot): PromptVariable {
    return PromptVariable.create({
      name: snapshot.name,
      description: snapshot.description,
      defaultValue: snapshot.defaultValue,
      required: snapshot.required,
    });
  }

  get name(): string {
    return this._name;
  }

  get description(): string | null {
    return this._description;
  }

  get defaultValue(): string | null {
    return this._defaultValue;
  }

  get required(): boolean {
    return this._required;
  }

  toSnapshot(): PromptVariableSnapshot {
    return {
      name: this._name,
      description: this._description,
      defaultValue: this._defaultValue,
      required: this._required,
    };
  }
}

const normalizeOptional = (
  raw: string | null,
  maxLength: number,
  field: string,
): string | null => {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) {
    throw ValidationError(`Variable ${field} exceeds ${maxLength} chars`);
  }
  return trimmed;
};

// Validates a list of PromptVariable definitions for uniqueness. Returns the
// definitions back when valid, throws otherwise. Kept as a free function so
// callers can compose it in use cases without instantiating a wrapper type.
export const assertUniqueVariableNames = (
  variables: readonly PromptVariable[],
): void => {
  const seen = new Set<string>();
  for (const v of variables) {
    if (seen.has(v.name)) {
      throw ValidationError(`Duplicate variable name: "${v.name}"`);
    }
    seen.add(v.name);
  }
};
