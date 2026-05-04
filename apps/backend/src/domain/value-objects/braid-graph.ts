import type { BraidNodeKind } from "@plexus/shared-types";
import { ValidationError } from "../errors/domain-error.js";

interface BraidNode {
  id: string;
  label: string;
  kind: BraidNodeKind;
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
const NODE_ID_PATTERN = /^[A-Za-z][\w-]*$/;
const NODE_LABEL_MAX = 200;
const EDGE_LABEL_MAX = 80;
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

// Immutable graph value object. Every mutation returns a new instance
// so concurrent callers cannot observe a half-applied state. Mermaid
// is the canonical wire format — `fromStructured` round-trips through
// `toMermaid` so a structurally-mutated graph stays parseable.
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

    return new BraidGraph(trimmed, [...nodes.values()], edges);
  }

  // Builds a new BraidGraph from structured nodes/edges, generating
  // mermaid via `toMermaid`. Used by mutation methods so callers never
  // have to assemble mermaid by hand.
  static fromStructured(nodes: BraidNode[], edges: BraidEdge[]): BraidGraph {
    if (nodes.length === 0) {
      throw ValidationError("BRAID graph must contain at least one node");
    }
    return new BraidGraph(toMermaid(nodes, edges), nodes, edges);
  }

  // ── Mutations (each returns a new BraidGraph) ─────────────────────────────

  renameNode(nodeId: string, newLabel: string): BraidGraph {
    const node = this.findNode(nodeId);
    if (!node) {
      throw ValidationError(`Node ${nodeId} does not exist in this graph`);
    }
    const trimmed = newLabel.trim();
    assertLabel(trimmed, NODE_LABEL_MAX, node.kind);
    const nodes = this.nodes.map((n) =>
      n.id === nodeId ? { ...n, label: trimmed } : n,
    );
    return BraidGraph.fromStructured(nodes, this.edges);
  }

  // Caller picks the kind. ID is auto-generated as `N{n+1}` where `n`
  // is the highest existing `N\d+` id — keeps mermaid readable
  // (`N3[Plan]` rather than UUIDs in node labels).
  addNode(
    label: string,
    kind: BraidNodeKind,
  ): { graph: BraidGraph; nodeId: string } {
    const trimmed = label.trim();
    assertLabel(trimmed, NODE_LABEL_MAX, kind);
    const id = nextNodeId(this.nodes);
    const newNode: BraidNode = { id, label: trimmed, kind };
    return {
      graph: BraidGraph.fromStructured([...this.nodes, newNode], this.edges),
      nodeId: id,
    };
  }

  // Cascades through edges: any edge touching the removed node is also
  // dropped. Without the cascade the resulting graph would have orphan
  // edges referencing a non-existent node — invalid mermaid.
  removeNode(nodeId: string): BraidGraph {
    if (!this.findNode(nodeId)) {
      throw ValidationError(`Node ${nodeId} does not exist in this graph`);
    }
    if (this.nodes.length === 1) {
      throw ValidationError("Cannot remove the only node in the graph");
    }
    const nodes = this.nodes.filter((n) => n.id !== nodeId);
    const edges = this.edges.filter(
      (e) => e.from !== nodeId && e.to !== nodeId,
    );
    return BraidGraph.fromStructured(nodes, edges);
  }

  addEdge(from: string, to: string, label: string | null): BraidGraph {
    if (!this.findNode(from)) {
      throw ValidationError(`Edge source node ${from} does not exist`);
    }
    if (!this.findNode(to)) {
      throw ValidationError(`Edge target node ${to} does not exist`);
    }
    const normalised = normaliseEdgeLabel(label);
    if (this.edges.some((e) => edgeMatches(e, from, to, normalised))) {
      throw ValidationError(
        `Edge ${from} → ${to}${normalised ? ` (${normalised})` : ""} already exists`,
      );
    }
    return BraidGraph.fromStructured(this.nodes, [
      ...this.edges,
      { from, to, label: normalised },
    ]);
  }

  removeEdge(from: string, to: string, label: string | null): BraidGraph {
    const normalised = normaliseEdgeLabel(label);
    const idx = this.edges.findIndex((e) => edgeMatches(e, from, to, normalised));
    if (idx === -1) {
      throw ValidationError(`Edge ${from} → ${to} not found`);
    }
    const edges = this.edges.filter((_, i) => i !== idx);
    return BraidGraph.fromStructured(this.nodes, edges);
  }

  relabelEdge(
    from: string,
    to: string,
    oldLabel: string | null,
    newLabel: string | null,
  ): BraidGraph {
    const oldNorm = normaliseEdgeLabel(oldLabel);
    const newNorm = normaliseEdgeLabel(newLabel);
    if (oldNorm === newNorm) return this;
    const idx = this.edges.findIndex((e) => edgeMatches(e, from, to, oldNorm));
    if (idx === -1) {
      throw ValidationError(`Edge ${from} → ${to} not found`);
    }
    // Reject if the relabel would collide with another existing edge
    // between the same nodes.
    if (
      this.edges.some(
        (e, i) => i !== idx && edgeMatches(e, from, to, newNorm),
      )
    ) {
      throw ValidationError(
        `Edge ${from} → ${to} with the new label already exists`,
      );
    }
    const edges = this.edges.map((e, i) =>
      i === idx ? { ...e, label: newNorm } : e,
    );
    return BraidGraph.fromStructured(this.nodes, edges);
  }

  private findNode(id: string): BraidNode | undefined {
    return this.nodes.find((n) => n.id === id);
  }
}

const extractNodes = (code: string): Map<string, BraidNode> => {
  const nodes = new Map<string, BraidNode>();
  for (const match of code.matchAll(NODE_DEFINITION)) {
    const id = match[1];
    const stepLabel = match[2];
    const decisionLabel = match[3];
    const label = stepLabel ?? decisionLabel;
    if (id && label && !nodes.has(id)) {
      const kind: BraidNodeKind =
        decisionLabel !== undefined ? "decision" : "step";
      nodes.set(id, { id, label: label.trim(), kind });
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

// Mermaid serializer. Labels are emitted as-is — boundary validation
// (`assertLabel`, `normaliseEdgeLabel`) rejects characters that would
// break mermaid syntax (brackets/braces in node labels, double quotes
// in edge labels), so the serializer never has to silently strip
// content. One node/edge per line keeps diffs readable.
const toMermaid = (nodes: BraidNode[], edges: BraidEdge[]): string => {
  const lines: string[] = ["flowchart TD;"];
  for (const node of nodes) {
    const shape =
      node.kind === "decision"
        ? `{${node.label}}`
        : `[${node.label}]`;
    lines.push(`  ${node.id}${shape};`);
  }
  for (const edge of edges) {
    if (edge.label !== null) {
      lines.push(`  ${edge.from} -- "${edge.label}" --> ${edge.to};`);
    } else {
      lines.push(`  ${edge.from} --> ${edge.to};`);
    }
  }
  return lines.join("\n");
};

// Sequential node-id generator. Picks the next free `N\d+` so manually
// created nodes stay readable in mermaid (`N4[Plan]`) — using crypto
// random IDs would clutter the source.
const nextNodeId = (nodes: BraidNode[]): string => {
  const taken = new Set(nodes.map((n) => n.id));
  let counter = 1;
  while (taken.has(`N${counter}`)) counter += 1;
  return `N${counter}`;
};

// Step nodes use `[label]` mermaid syntax — labels can't contain `[`
// or `]` (mermaid would close the bracket prematurely or parse
// "label]" as nested). Step labels CAN contain `{` and `}` because
// the outer `[]` are the delimiters; this is what lets template
// references like `{{topic}}` survive a step-node label round-trip.
//
// Decision nodes use `{label}` — the inverse: `{` and `}` are
// forbidden because they collide with the delimiter (mermaid's
// `{...}` matches the first `}`). Variable references in decision
// labels are not supported in v1.
const STEP_LABEL_FORBIDDEN = /[\[\]]/;
const DECISION_LABEL_FORBIDDEN = /[{}]/;

const assertLabel = (
  label: string,
  max: number,
  nodeKind: BraidNodeKind,
): void => {
  if (label.length === 0) {
    throw ValidationError("node label cannot be empty");
  }
  if (label.length > max) {
    throw ValidationError(`node label exceeds ${max}-character limit`);
  }
  const forbidden =
    nodeKind === "decision" ? DECISION_LABEL_FORBIDDEN : STEP_LABEL_FORBIDDEN;
  if (forbidden.test(label)) {
    throw ValidationError(
      nodeKind === "decision"
        ? "decision-node label cannot contain braces"
        : "step-node label cannot contain brackets",
    );
  }
};

// Treats empty / whitespace-only labels as `null` so callers can pass
// either shape. Without this, edges with `label: ""` and `label: null`
// would be considered distinct and never match. Double-quotes break
// the `-- "label" -->` mermaid syntax — rejected at the boundary
// rather than silently rewritten.
const normaliseEdgeLabel = (label: string | null): string | null => {
  if (label === null) return null;
  const trimmed = label.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > EDGE_LABEL_MAX) {
    throw ValidationError(`edge label exceeds ${EDGE_LABEL_MAX}-character limit`);
  }
  if (trimmed.includes('"')) {
    throw ValidationError("edge label cannot contain double-quote characters");
  }
  return trimmed;
};

const edgeMatches = (
  edge: BraidEdge,
  from: string,
  to: string,
  label: string | null,
): boolean =>
  edge.from === from && edge.to === to && edge.label === label;

// Exported for use cases that need to pre-validate node ids before
// reaching the aggregate boundary.
export const isValidNodeId = (id: string): boolean => NODE_ID_PATTERN.test(id);
