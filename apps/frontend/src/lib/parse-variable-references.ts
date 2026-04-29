// Mirror of `extractVariableReferences` on the backend so the editor can
// preview which `{{var}}` references are present without round-tripping to
// the server. Tolerates whitespace inside braces (`{{ name }}`) and ignores
// names that don't match the declared variable grammar.
const REFERENCE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export const parseVariableReferences = (body: string): string[] => {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const match of body.matchAll(REFERENCE_PATTERN)) {
    const name = match[1];
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    order.push(name);
  }
  return order;
};
