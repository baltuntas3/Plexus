// Template placeholder grammar: `{{name}}` where `name` is the same form
// PromptVariable enforces. Whitespace inside the braces is tolerated
// (`{{ name }}` works) since users naturally type both forms; the captured
// name itself is trimmed.
const REFERENCE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

// Extracts every `{{name}}` reference from a body, deduplicated, in
// first-occurrence order. Used by use cases to validate that a prompt body's
// references are a subset of the version's declared variables.
export const extractVariableReferences = (body: string): string[] => {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const match of body.matchAll(REFERENCE_PATTERN)) {
    const name = match[1];
    if (name === undefined) continue;
    if (!seen.has(name)) {
      seen.add(name);
      order.push(name);
    }
  }
  return order;
};
