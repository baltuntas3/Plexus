import type { BraidGraphDto } from "@plexus/shared-types";
import type { BraidGraph } from "../../domain/value-objects/braid-graph.js";

// `BraidGraph` entity → DTO adapter. Used only by the `/generateBraid`
// controller response (`graph: toBraidGraphDto(result.graph)`) — the
// version read DTO ships only the canonical mermaid string and the
// frontend parses it client-side via `parseBraidMermaid`. Kept as a
// named function so the controller doesn't inline the per-row
// `nodes.map(...)` / `edges.map(...)` literal.
export const toBraidGraphDto = (graph: BraidGraph): BraidGraphDto => ({
  mermaidCode: graph.mermaidCode,
  nodes: graph.nodes.map((n) => ({ id: n.id, label: n.label, kind: n.kind })),
  edges: graph.edges.map((e) => ({ from: e.from, to: e.to, label: e.label })),
});
