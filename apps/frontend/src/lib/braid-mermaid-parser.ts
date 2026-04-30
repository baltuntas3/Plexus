import type { BraidEdgeDto, BraidGraphDto, BraidNodeKind } from "@plexus/shared-types";

// Client-side mirror of `BraidGraph.parse` extractNodes/extractEdges.
// The visual editor needs structured nodes/edges from the canonical
// mermaid string the backend ships; we duplicate the regex extraction
// rather than thread a parsed projection through every read DTO. Write
// validation still lives on the backend (`BraidGraph.parse` rejects
// invalid mermaid before persistence), so this parser only ever runs
// against strings that already round-tripped through the canonical
// parser — a structural failure here means a backend bug, not user
// input. Returns null for that defensive case so the editor can fall
// back to text mode rather than crash.

const HEADER_PATTERN = /^\s*(flowchart|graph)\s+TD\s*;?\s*$/m;

const NODE_ID = "[A-Za-z][\\w-]*";
const NODE_SHAPE_OPTIONAL = "(?:\\[[^\\]]+\\]|\\{[^}]+\\})?";

const NODE_DEFINITION = /\b([A-Za-z][\w-]*)(?:\[([^\]]+)\]|\{([^}]+)\})/g;

const buildEdgeRegex = (middle: string): RegExp =>
  new RegExp(
    `\\b(${NODE_ID})${NODE_SHAPE_OPTIONAL}\\s*${middle}\\s*(${NODE_ID})${NODE_SHAPE_OPTIONAL}`,
    "g",
  );

const EDGE_WITH_QUOTED_LABEL = buildEdgeRegex(`--\\s*"([^"]*)"\\s*-->`);
const EDGE_WITH_PIPE_LABEL = buildEdgeRegex(`-->\\s*\\|([^|]*)\\|`);
const EDGE_PLAIN = buildEdgeRegex(`-->`);

export const parseBraidMermaid = (mermaidCode: string): BraidGraphDto | null => {
  const trimmed = mermaidCode.trim();
  if (trimmed.length === 0) return null;
  if (!HEADER_PATTERN.test(trimmed)) return null;

  const nodes = new Map<string, { id: string; label: string; kind: BraidNodeKind }>();
  for (const match of trimmed.matchAll(NODE_DEFINITION)) {
    const id = match[1];
    const stepLabel = match[2];
    const decisionLabel = match[3];
    const label = stepLabel ?? decisionLabel;
    if (id && label && !nodes.has(id)) {
      const kind: BraidNodeKind = decisionLabel !== undefined ? "decision" : "step";
      nodes.set(id, { id, label: label.trim(), kind });
    }
  }
  if (nodes.size === 0) return null;

  const edges: BraidEdgeDto[] = [];
  const seen = new Set<string>();
  const addEdge = (from: string, to: string, label: string | null): void => {
    const key = `${from}->${to}:${label ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, label });
  };
  for (const match of trimmed.matchAll(EDGE_WITH_QUOTED_LABEL)) {
    const [, from, label, to] = match;
    if (from && to) addEdge(from, to, label ?? null);
  }
  for (const match of trimmed.matchAll(EDGE_WITH_PIPE_LABEL)) {
    const [, from, label, to] = match;
    if (from && to) addEdge(from, to, label ?? null);
  }
  for (const match of trimmed.matchAll(EDGE_PLAIN)) {
    const [, from, to] = match;
    if (from && to && !seen.has(`${from}->${to}:`)) {
      addEdge(from, to, null);
    }
  }

  return {
    mermaidCode: trimmed,
    nodes: [...nodes.values()],
    edges,
  };
};
