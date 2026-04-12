import { ValidationError } from "../errors/domain-error.js";

export interface BraidNode {
  id: string;
  label: string;
}

export interface BraidEdge {
  from: string;
  to: string;
  label: string | null;
}

const HEADER_PATTERN = /^\s*(flowchart|graph)\s+TD\s*;?\s*$/m;

// Node identifier and shape fragments. Diamond `{...}` nodes are BRAID decision
// points; square `[...]` is the default step node shape.
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

export class BraidGraph {
  constructor(
    public readonly mermaidCode: string,
    public readonly nodes: BraidNode[],
    public readonly edges: BraidEdge[],
  ) {}

  static parse(mermaidCode: string): BraidGraph {
    const trimmed = mermaidCode.trim();
    if (trimmed.length === 0) {
      throw ValidationError("BRAID graph is empty");
    }
    if (!HEADER_PATTERN.test(trimmed)) {
      throw ValidationError("BRAID graph must start with 'flowchart TD' or 'graph TD'");
    }

    const nodes = extractNodes(trimmed);
    const edges = extractEdges(trimmed);

    if (nodes.size === 0) {
      throw ValidationError("BRAID graph must contain at least one node");
    }

    return new BraidGraph(
      trimmed,
      [...nodes.entries()].map(([id, label]) => ({ id, label })),
      edges,
    );
  }

  get nodeCount(): number {
    return this.nodes.length;
  }

  get edgeCount(): number {
    return this.edges.length;
  }
}

const extractNodes = (code: string): Map<string, string> => {
  const nodes = new Map<string, string>();
  for (const match of code.matchAll(NODE_DEFINITION)) {
    const id = match[1];
    // Group 2: square bracket label, Group 3: curly brace label.
    const label = match[2] ?? match[3];
    if (id && label && !nodes.has(id)) {
      nodes.set(id, label.trim());
    }
  }
  return nodes;
};

const extractEdges = (code: string): BraidEdge[] => {
  const edges: BraidEdge[] = [];
  const seen = new Set<string>();

  const addEdge = (from: string, to: string, label: string | null): void => {
    const key = `${from}->${to}:${label ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, label });
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

  return edges;
};
