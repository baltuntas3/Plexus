// Canonical grammar for template variable names and `{{name}}` placeholders.
// Backend domain (PromptVariable, integrity check), backend Zod boundary,
// frontend editor (Monaco decoration, validation), and SDK runtime all read
// from here so the parser and validator cannot drift apart.

export const VARIABLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// Source string used when a regex needs to be embedded inside another pattern
// (the placeholder regex below) or rebuilt with different flags. The leading
// `^` / trailing `$` anchors are stripped from the published source so it can
// be inlined as a sub-pattern.
export const VARIABLE_NAME_PATTERN_SOURCE = "[a-zA-Z_][a-zA-Z0-9_]*";

// `{{name}}` placeholder. Whitespace inside the braces is tolerated
// (`{{ name }}` works) since users naturally type both forms; the captured
// name is whitespace-trimmed by the regex itself.
export const VARIABLE_PLACEHOLDER_PATTERN = new RegExp(
  `\\{\\{\\s*(${VARIABLE_NAME_PATTERN_SOURCE})\\s*\\}\\}`,
  "g",
);

// Returns true when the trimmed string is a syntactically valid variable name.
export const isValidVariableName = (name: string): boolean =>
  VARIABLE_NAME_PATTERN.test(name.trim());

// Extracts every `{{name}}` reference from a body, deduplicated, in
// first-occurrence order. Use cases call this on prompt bodies and braid
// node labels to validate that referenced names are a subset of the version's
// declared variable list.
export const extractVariableReferences = (body: string): string[] => {
  const seen = new Set<string>();
  const order: string[] = [];
  // RegExp stateful flag means each consumer needs a fresh exec loop; use
  // `matchAll` which yields a fresh iterator and never mutates lastIndex.
  for (const match of body.matchAll(VARIABLE_PLACEHOLDER_PATTERN)) {
    const name = match[1];
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    order.push(name);
  }
  return order;
};
