import { ValidationError } from "../../../domain/errors/domain-error.js";
import type { PromptVariable } from "../../../domain/value-objects/prompt-variable.js";
import { extractVariableReferences } from "../../../domain/value-objects/variable-references.js";

// Reference→definition integrity check applied by every use case that creates
// or forks a PromptVersion. Lives in the application layer, not on the
// aggregate, because it is a cross-field rule that combines body parsing with
// the variable list — pure domain code stays free of body parsing concerns.
//
// Rule: every `{{name}}` referenced in `body` (and optional `mermaid`) must
// be declared in `variables`. Definitions present without any reference are
// allowed (the user may be staging a placeholder for a follow-up edit) — the
// reverse direction is the hard error.
export interface VariableIntegrityInput {
  body: string;
  mermaid?: string | null;
  variables: readonly PromptVariable[];
}

export const assertVariableIntegrity = (
  input: VariableIntegrityInput,
): void => {
  const declared = new Set(input.variables.map((v) => v.name));
  const referenced = new Set<string>();
  for (const ref of extractVariableReferences(input.body)) {
    referenced.add(ref);
  }
  if (input.mermaid) {
    for (const ref of extractVariableReferences(input.mermaid)) {
      referenced.add(ref);
    }
  }

  const undeclared: string[] = [];
  for (const ref of referenced) {
    if (!declared.has(ref)) undeclared.push(ref);
  }
  if (undeclared.length > 0) {
    throw ValidationError(
      `Prompt references undeclared variables: ${undeclared
        .map((n) => `{{${n}}}`)
        .join(", ")}. Add them to the version's variable list or remove the references.`,
      { undeclared },
    );
  }
};
