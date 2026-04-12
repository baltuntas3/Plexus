import { memo, useMemo } from "react";
import { Alert, Paper } from "@mantine/core";
import Dagre from "@dagrejs/dagre";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import {
  isVerificationNode,
  parseBraidGraph,
  type ParsedGraph,
  type ParsedNode,
} from "../lib/parse-braid-graph.js";

interface BraidViewProps {
  mermaidCode: string;
}

type BraidNodeKind = "step" | "decision" | "verification";

interface BraidNodeData extends Record<string, unknown> {
  label: string;
  kind: BraidNodeKind;
}

type BraidFlowNode = Node<BraidNodeData, "braid">;

const NODE_WIDTH = 220;
const NODE_HEIGHT = 72;

const PALETTE: Record<BraidNodeKind, { bg: string; border: string; text: string }> = {
  step: { bg: "#1e293b", border: "#475569", text: "#e2e8f0" },
  decision: { bg: "#78350f", border: "#f59e0b", text: "#fef3c7" },
  verification: { bg: "#064e3b", border: "#10b981", text: "#d1fae5" },
};

const classifyNode = (node: ParsedNode): BraidNodeKind => {
  if (isVerificationNode(node.label)) return "verification";
  if (node.shape === "diamond") return "decision";
  return "step";
};

const BraidNodeView = memo(({ data }: NodeProps<BraidFlowNode>) => {
  const palette = PALETTE[data.kind];
  return (
    <div
      style={{
        width: NODE_WIDTH,
        minHeight: NODE_HEIGHT,
        padding: "10px 14px",
        borderRadius: data.kind === "decision" ? 4 : 10,
        background: palette.bg,
        border: `1.5px solid ${palette.border}`,
        color: palette.text,
        fontSize: 12,
        fontWeight: 500,
        lineHeight: 1.4,
        textAlign: "center",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
        whiteSpace: "normal",
        wordBreak: "break-word",
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: palette.border, width: 8, height: 8, border: "none" }}
      />
      <span>{data.label}</span>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: palette.border, width: 8, height: 8, border: "none" }}
      />
    </div>
  );
});
BraidNodeView.displayName = "BraidNodeView";

const nodeTypes: NodeTypes = { braid: BraidNodeView };

const layout = (graph: ParsedGraph): { nodes: BraidFlowNode[]; edges: Edge[] } => {
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", ranksep: 80, nodesep: 50, marginx: 24, marginy: 24 });

  for (const node of graph.nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of graph.edges) {
    if (g.hasNode(edge.from) && g.hasNode(edge.to)) {
      g.setEdge(edge.from, edge.to);
    }
  }

  Dagre.layout(g);

  const nodes: BraidFlowNode[] = graph.nodes.map((node) => {
    const pos = g.node(node.id);
    const kind = classifyNode(node);
    return {
      id: node.id,
      type: "braid",
      position: {
        x: (pos?.x ?? 0) - NODE_WIDTH / 2,
        y: (pos?.y ?? 0) - NODE_HEIGHT / 2,
      },
      data: { label: node.label, kind },
      draggable: true,
    };
  });

  const edges: Edge[] = graph.edges.map((edge, index) => ({
    id: `e${index}-${edge.from}-${edge.to}`,
    source: edge.from,
    target: edge.to,
    label: edge.label ?? undefined,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8", width: 18, height: 18 },
    style: { stroke: "#94a3b8", strokeWidth: 1.75 },
    labelStyle: { fill: "#e2e8f0", fontSize: 11, fontWeight: 600 },
    labelBgStyle: { fill: "#0f172a" },
    labelBgPadding: [6, 3],
    labelBgBorderRadius: 4,
  }));

  return { nodes, edges };
};

export const BraidView = ({ mermaidCode }: BraidViewProps) => {
  const { nodes, edges, error } = useMemo(() => {
    try {
      const parsed = parseBraidGraph(mermaidCode);
      if (parsed.nodes.length === 0) {
        return { nodes: [], edges: [], error: "Graph has no nodes." };
      }
      const laid = layout(parsed);
      return { nodes: laid.nodes, edges: laid.edges, error: null as string | null };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to parse graph";
      return { nodes: [], edges: [], error: message };
    }
  }, [mermaidCode]);

  if (error) {
    return (
      <Alert color="red" title="Graph render error">
        {error}
      </Alert>
    );
  }

  return (
    <Paper
      withBorder
      p={0}
      style={{ overflow: "hidden", height: "60vh", background: "#0b1220" }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={2}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#1e293b" />
        <MiniMap
          pannable
          zoomable
          maskColor="rgba(15, 23, 42, 0.7)"
          nodeColor={(node) => {
            const kind = (node.data as BraidNodeData | undefined)?.kind ?? "step";
            return PALETTE[kind].border;
          }}
        />
        <Controls showInteractive={false} />
      </ReactFlow>
    </Paper>
  );
};
