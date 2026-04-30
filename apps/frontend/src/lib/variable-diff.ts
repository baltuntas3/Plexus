import type { PromptVariableInput } from "@plexus/shared-types";

// Structural equality for two variable lists. Treats `description: null`
// and `description: undefined` as equivalent so a freshly inherited list
// (which carries `null`) does not register as "changed" against the same
// list re-rendered through the form (which may produce `undefined`).
//
// Returns true when the lists differ — the editor uses this to decide
// whether to send `variables` on `createVersion` (override) or omit it
// (let the backend inherit from the parent version).
export const hasVariableListChanged = (
  next: readonly PromptVariableInput[],
  baseline: readonly PromptVariableInput[],
): boolean => {
  if (next.length !== baseline.length) return true;
  for (let i = 0; i < next.length; i += 1) {
    const a = next[i];
    const b = baseline[i];
    if (!a || !b) return true;
    if (
      a.name !== b.name ||
      (a.description ?? null) !== (b.description ?? null) ||
      (a.defaultValue ?? null) !== (b.defaultValue ?? null) ||
      (a.required ?? false) !== (b.required ?? false)
    ) {
      return true;
    }
  }
  return false;
};
