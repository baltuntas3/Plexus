// Single source of truth for the template-variable rule pasted into every
// prompt that hands `{{name}}` placeholders to an LLM. Three call sites
// previously hand-wrote near-identical wording (test-case generator,
// BRAID chat agent, evaluation-spec generation helper) — drift between
// them would have let one prompt silently teach the model a different
// substitution policy from another.

export const TEMPLATE_VARIABLE_PLACEHOLDER_RULE_FULL =
  "Template variables of the form {{name}} are LITERAL placeholders that the runtime substitutes server-side. Do NOT invent new {{...}} names. When variables are listed, only reference names from that list — either substitute a realistic concrete value that matches the variable's description, or keep the {{name}} placeholder verbatim when that preserves the structural intent.";

export const TEMPLATE_VARIABLE_PLACEHOLDER_RULE_SHORT =
  "{{name}} placeholders are LITERAL — the runtime substitutes them server-side. Preserve them as-is in node labels or other content; do NOT inline concrete values and do NOT invent new {{...}} names.";

export interface TemplateVariableSpec {
  name: string;
  description?: string | null;
  defaultValue?: string | null;
  required: boolean;
}

// Renders a list of declared variables for inclusion in a prompt. Returns
// `null` when the version has no variables, so callers can skip the block
// entirely instead of emitting an empty header.
export const formatTemplateVariableList = (
  variables: readonly TemplateVariableSpec[],
): string | null => {
  if (variables.length === 0) return null;
  const lines = variables.map((v) => {
    const parts: string[] = [`{{${v.name}}}${v.required ? "" : " (optional)"}`];
    const desc = v.description?.trim();
    if (desc) parts.push(`— ${desc}`);
    const def = v.defaultValue?.trim();
    if (def) parts.push(`(default: ${def})`);
    return `- ${parts.join(" ")}`;
  });
  return lines.join("\n");
};
