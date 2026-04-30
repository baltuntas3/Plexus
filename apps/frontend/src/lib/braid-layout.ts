import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { BraidGraphDto, BraidGraphLayoutDto } from "@plexus/shared-types";

// Sequential top-down layout for the visual editor. Mermaid doesn't
// carry coordinates and we don't ship a layout algorithm (dagre/elk)
// for v1; nodes are stacked by topological depth so the layout is
// deterministic and readable without extra deps.
//
// Saved positions (persisted via the layout endpoint) take precedence
// node-by-node — newly added nodes that have no saved entry fall back
// to auto-layout so layout migration across structural edits is
// automatic.
const COLUMN_WIDTH = 220;
const ROW_HEIGHT = 110;

export const computeLayout = (
  graph: BraidGraphDto,
  savedLayout: BraidGraphLayoutDto | null = null,
): Map<string, { x: number; y: number }> => {
  // Index saved positions for O(1) lookup; nodes without a saved
  // entry fall through to auto-layout below.
  const saved = new Map<string, { x: number; y: number }>();
  if (savedLayout) {
    for (const p of savedLayout.positions) {
      saved.set(p.nodeId, { x: p.x, y: p.y });
    }
  }

  const positions = new Map<string, { x: number; y: number }>();
  const incoming = new Map<string, number>();
  for (const n of graph.nodes) incoming.set(n.id, 0);
  for (const e of graph.edges) {
    incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
  }
  const depth = new Map<string, number>();
  const roots = graph.nodes
    .filter((n) => (incoming.get(n.id) ?? 0) === 0)
    .map((n) => n.id);
  const queue: string[] =
    roots.length > 0 ? [...roots] : graph.nodes.slice(0, 1).map((n) => n.id);
  for (const id of queue) depth.set(id, 0);
  while (queue.length > 0) {
    const id = queue.shift()!;
    const d = depth.get(id) ?? 0;
    for (const e of graph.edges) {
      if (e.from === id && !depth.has(e.to)) {
        depth.set(e.to, d + 1);
        queue.push(e.to);
      }
    }
  }
  // Anything unreachable from a root: append at the end.
  let trailing = 0;
  for (const n of graph.nodes) {
    if (!depth.has(n.id)) {
      depth.set(n.id, Math.max(...depth.values(), 0) + 1 + trailing);
      trailing += 1;
    }
  }
  const byDepth = new Map<number, string[]>();
  for (const [id, d] of depth) {
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(id);
  }
  for (const [d, ids] of byDepth) {
    ids.forEach((id, i) => {
      const savedPos = saved.get(id);
      if (savedPos) {
        positions.set(id, savedPos);
        return;
      }
      const offset = (i - (ids.length - 1) / 2) * COLUMN_WIDTH;
      positions.set(id, { x: offset, y: d * ROW_HEIGHT });
    });
  }
  return positions;
};

// Stable edge key: same shape used by the BraidGraph aggregate's
// `edgeMatches` (`from->to:label`). Used both to identify ReactFlow
// edges and to map back from `Edge.id` to the structured BraidEdgeDto
// when the user clicks/deletes one.
export const edgeKey = (
  from: string,
  to: string,
  label: string | null,
): string => `${from}->${to}:${label ?? ""}`;

export const toReactFlowNodes = (
  graph: BraidGraphDto,
  positions: Map<string, { x: number; y: number }>,
): Node[] =>
  graph.nodes.map((n) => ({
    id: n.id,
    data: { label: `${n.id}: ${n.label}`, kind: n.kind },
    position: positions.get(n.id) ?? { x: 0, y: 0 },
    style: {
      background: n.kind === "decision" ? "#fde68a" : "#dbeafe",
      border: "1px solid #1f2937",
      borderRadius: n.kind === "decision" ? 0 : 6,
      padding: 8,
      fontSize: 12,
      // Decision nodes get a faux-diamond via clip-path; ReactFlow
      // doesn't natively support shape changes, but the visual cue is
      // enough to distinguish kinds at a glance.
      clipPath:
        n.kind === "decision"
          ? "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)"
          : undefined,
      width: 180,
      textAlign: "center" as const,
    },
  }));

export const toReactFlowEdges = (graph: BraidGraphDto): Edge[] =>
  graph.edges.map((e) => ({
    id: edgeKey(e.from, e.to, e.label),
    source: e.from,
    target: e.to,
    label: e.label ?? undefined,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: "#1f2937" },
  }));
