// Minimal Mermaid flowchart parser matching the subset the BRAID generator
// produces. Ported from apps/backend/src/domain/value-objects/braid-graph.ts.
// We keep it client-side so version pages can render persisted mermaid strings
// without a round-trip.

export interface ParsedNode {
  id: string;
  label: string;
  shape: "rect" | "diamond";
}

export interface ParsedEdge {
  from: string;
  to: string;
  label: string | null;
}

export interface ParsedGraph {
  nodes: ParsedNode[];
  edges: ParsedEdge[];
}

const NODE_ID_FRAGMENT = "[A-Za-z][\\w-]*";
const NODE_SHAPE_OPTIONAL = "(?:\\[[^\\]]+\\]|\\{[^}]+\\})?";

const NODE_DEFINITION = /\b([A-Za-z][\w-]*)(?:\[([^\]]+)\]|\{([^}]+)\})/g;

const buildEdgeRegex = (middle: string): RegExp =>
  new RegExp(
    `\\b(${NODE_ID_FRAGMENT})${NODE_SHAPE_OPTIONAL}\\s*${middle}\\s*(${NODE_ID_FRAGMENT})${NODE_SHAPE_OPTIONAL}`,
    "g",
  );

const EDGE_WITH_QUOTED_LABEL = buildEdgeRegex(`--\\s*"([^"]*)"\\s*-->`);
const EDGE_WITH_PIPE_LABEL = buildEdgeRegex(`-->\\s*\\|([^|]*)\\|`);
const EDGE_PLAIN = buildEdgeRegex(`-->`);

export const parseBraidGraph = (mermaidCode: string): ParsedGraph => {
  const code = mermaidCode.trim();
  const nodeMap = new Map<string, ParsedNode>();

  for (const match of code.matchAll(NODE_DEFINITION)) {
    const id = match[1];
    const rectLabel = match[2];
    const diamondLabel = match[3];
    if (!id) continue;
    if (nodeMap.has(id)) continue;
    const label = (rectLabel ?? diamondLabel ?? "").trim();
    const shape: ParsedNode["shape"] = diamondLabel ? "diamond" : "rect";
    nodeMap.set(id, { id, label, shape });
  }

  const edges: ParsedEdge[] = [];
  const seen = new Set<string>();
  const addEdge = (from: string, to: string, label: string | null): void => {
    const key = `${from}->${to}:${label ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, label });
    ensureNode(nodeMap, from);
    ensureNode(nodeMap, to);
  };

  for (const match of code.matchAll(EDGE_WITH_QUOTED_LABEL)) {
    const [, from, label, to] = match;
    if (from && to) addEdge(from, to, label ?? null);
  }
  for (const match of code.matchAll(EDGE_WITH_PIPE_LABEL)) {
    const [, from, label, to] = match;
    if (from && to) addEdge(from, to, label ?? null);
  }
  for (const match of code.matchAll(EDGE_PLAIN)) {
    const [, from, to] = match;
    if (from && to && !seen.has(`${from}->${to}:`)) {
      addEdge(from, to, null);
    }
  }

  return { nodes: [...nodeMap.values()], edges };
};

const ensureNode = (map: Map<string, ParsedNode>, id: string): void => {
  if (map.has(id)) return;
  map.set(id, { id, label: id, shape: "rect" });
};

const VERIFICATION_PREFIX = /^(check|verify|validate|assert|critic):/i;

export const isVerificationNode = (label: string): boolean =>
  VERIFICATION_PREFIX.test(label.trim());
