import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  ConnectionMode,
  Controls,
  ReactFlow,
  type Node,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  type OnConnect,
  type OnNodesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button, Group, Modal, Select, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useNavigate } from "react-router-dom";
import { useSetAtom } from "jotai";
import {
  BRAID_NODE_KINDS,
  type BraidGraphLayoutDto,
  type BraidNodeDto,
  type BraidNodeKind,
  type PromptVariableDto,
} from "@plexus/shared-types";
import {
  addBraidEdgeAtom,
  addBraidNodeAtom,
  relabelBraidEdgeAtom,
  removeBraidEdgeAtom,
  removeBraidNodeAtom,
  renameBraidNodeAtom,
  updateBraidLayoutAtom,
  type BraidEditResponse,
} from "../atoms/braid.atoms.js";
import { ApiError } from "../lib/api-client.js";
import {
  computeLayout,
  edgeKey,
  toReactFlowEdges,
  toReactFlowNodes,
} from "../lib/braid-layout.js";
import { parseBraidMermaid } from "../lib/braid-mermaid-parser.js";
import { VariableAwareInput } from "./variable-aware-input.js";

interface BraidVisualEditorProps {
  promptId: string;
  version: string;
  // Canonical mermaid serialisation. Parsed client-side into structured
  // nodes/edges; the backend ships the raw string only.
  mermaidCode: string;
  // Saved positions from a previous drag session, if any. Null →
  // pure auto-layout. Saved positions take precedence node-by-node;
  // newly added nodes (no saved entry) fall back to auto-layout.
  savedLayout: BraidGraphLayoutDto | null;
  // Variables declared on the source PromptVersion. Powers the `{{`
  // autocomplete in node label inputs so users can drop in template
  // placeholders without retyping the variable name.
  variables: ReadonlyArray<PromptVariableDto>;
}

// 500ms after the last drag-stop, the accumulated positions are sent
// to the backend in one PUT. Without debouncing, every drag-stop event
// would fire its own request — five round-trips per drag is excessive
// and clutters the dev console.
const LAYOUT_SAVE_DEBOUNCE_MS = 500;

export const BraidVisualEditor = ({
  promptId,
  version,
  mermaidCode,
  savedLayout,
  variables,
}: BraidVisualEditorProps) => {
  const navigate = useNavigate();
  const renameNode = useSetAtom(renameBraidNodeAtom);
  const addNode = useSetAtom(addBraidNodeAtom);
  const removeNode = useSetAtom(removeBraidNodeAtom);
  const addEdge = useSetAtom(addBraidEdgeAtom);
  const removeEdge = useSetAtom(removeBraidEdgeAtom);
  const relabelEdge = useSetAtom(relabelBraidEdgeAtom);
  const saveLayout = useSetAtom(updateBraidLayoutAtom);

  // Parse client-side. The backend has already validated this string
  // through `BraidGraph.parse` before persistence, so a null return
  // here means a backend bug — we render a fallback rather than crash.
  const graph = useMemo(() => parseBraidMermaid(mermaidCode), [mermaidCode]);

  const computedPositions = useMemo<Map<string, { x: number; y: number }>>(
    () => (graph ? computeLayout(graph, savedLayout) : new Map()),
    [graph, savedLayout],
  );
  // Local node state owns the live positions during drag. Seeded from
  // the computed layout (auto + saved) and updated optimistically by
  // ReactFlow's onNodesChange before we persist to the server. Reset
  // whenever the source graph or saved layout changes (new version).
  const [liveNodes, setLiveNodes] = useState<Node[]>(() =>
    graph ? toReactFlowNodes(graph, computedPositions) : [],
  );
  useEffect(() => {
    setLiveNodes(graph ? toReactFlowNodes(graph, computedPositions) : []);
  }, [graph, computedPositions]);
  const rfEdges = useMemo(() => (graph ? toReactFlowEdges(graph) : []), [graph]);

  // Debounce timer for layout save: dragging fires many position
  // events in quick succession, each cleared and re-set so the save
  // only fires once after the user stops moving.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      // Apply the changes optimistically (only `position` changes are
      // expected — drag is the only enabled interaction). ReactFlow's
      // applyNodeChanges helper isn't imported to keep deps small;
      // hand-rolled position-only patch is enough.
      setLiveNodes((prev) =>
        prev.map((n) => {
          const change = changes.find(
            (c) => c.type === "position" && c.id === n.id,
          );
          if (change && change.type === "position" && change.position) {
            return { ...n, position: change.position };
          }
          return n;
        }),
      );
      // Schedule a debounced save when a drag completes. ReactFlow
      // marks `dragging: false` on the change that ends the drag.
      const dragEnded = changes.some(
        (c) => c.type === "position" && c.dragging === false,
      );
      if (!dragEnded) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        // Snapshot current liveNodes positions; send them all so the
        // server sees a full replacement (the endpoint's PUT
        // semantics).
        setLiveNodes((current) => {
          const positions = current.map((n) => ({
            nodeId: n.id,
            x: n.position.x,
            y: n.position.y,
          }));
          void saveLayout({ promptId, version, positions }).catch(
            (err: unknown) => {
              const message =
                err instanceof ApiError ? err.message : "Failed to save layout";
              notifications.show({ color: "red", title: "Error", message });
            },
          );
          return current;
        });
      }, LAYOUT_SAVE_DEBOUNCE_MS);
    },
    [promptId, version, saveLayout],
  );

  const [busy, setBusy] = useState(false);
  const [renameTarget, setRenameTarget] = useState<BraidNodeDto | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameOpened, { open: openRename, close: closeRename }] = useDisclosure(false);
  // Names declared via the inline "create variable" popup option,
  // staged here until the modal saves. Sent in the rename payload so
  // the server fork carries the merged variable list.
  const [renameNewVars, setRenameNewVars] = useState<string[]>([]);

  const [addOpened, { open: openAdd, close: closeAdd }] = useDisclosure(false);
  const [addLabel, setAddLabel] = useState("");
  const [addKind, setAddKind] = useState<BraidNodeKind>("step");
  const [addNewVars, setAddNewVars] = useState<string[]>([]);

  // After every successful mutation the page navigates to the forked
  // version so the editor view stays in lock-step with the source of
  // truth (the new draft). Without this each edit would mutate the
  // server but the editor would keep showing the now-stale `version`.
  const onMutated = (res: BraidEditResponse, message: string) => {
    notifications.show({ color: "green", title: message, message: `Created ${res.newVersion}` });
    navigate(`/prompts/${promptId}/versions/${res.newVersion}`);
  };

  const handleError = (err: unknown, fallback: string) => {
    const message = err instanceof ApiError ? err.message : fallback;
    notifications.show({ color: "red", title: "Error", message });
  };

  const onNodeDoubleClick: NodeMouseHandler = useCallback((_event, node) => {
    if (!graph) return;
    const target = graph.nodes.find((n) => n.id === node.id);
    if (!target) return;
    setRenameTarget(target);
    setRenameDraft(target.label);
    setRenameNewVars([]);
    openRename();
  }, [graph, openRename]);

  // Stage a name registered via the popup's "create variable" option.
  // Dedup against the staging list and the source variables (caller's
  // prop) — the backend also dedupes but client-side avoids sending
  // redundant entries.
  const stageNewVar = (existing: string[], name: string): string[] => {
    if (variables.some((v) => v.name === name)) return existing;
    if (existing.includes(name)) return existing;
    return [...existing, name];
  };

  const handleRenameSubmit = async () => {
    if (!renameTarget) return;
    const label = renameDraft.trim();
    if (label.length === 0 || label === renameTarget.label) {
      closeRename();
      return;
    }
    setBusy(true);
    try {
      const res = await renameNode({
        promptId,
        version,
        nodeId: renameTarget.id,
        newLabel: label,
        addVariables: renameNewVars.length
          ? renameNewVars.map((name) => ({ name }))
          : undefined,
      });
      closeRename();
      onMutated(res, "Node renamed");
    } catch (err) {
      handleError(err, "Failed to rename node");
    } finally {
      setBusy(false);
    }
  };

  const handleAddSubmit = async () => {
    const label = addLabel.trim();
    if (label.length === 0) return;
    setBusy(true);
    try {
      const res = await addNode({
        promptId,
        version,
        label,
        kind: addKind,
        addVariables: addNewVars.length
          ? addNewVars.map((name) => ({ name }))
          : undefined,
      });
      closeAdd();
      setAddLabel("");
      setAddKind("step");
      setAddNewVars([]);
      onMutated(res, "Node added");
    } catch (err) {
      handleError(err, "Failed to add node");
    } finally {
      setBusy(false);
    }
  };

  const onConnect: OnConnect = useCallback(async (conn) => {
    if (!conn.source || !conn.target) return;
    setBusy(true);
    try {
      const res = await addEdge({
        promptId,
        version,
        fromNodeId: conn.source,
        toNodeId: conn.target,
      });
      onMutated(res, "Edge added");
    } catch (err) {
      handleError(err, "Failed to add edge");
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptId, version, addEdge]);

  const onEdgeDoubleClick: EdgeMouseHandler = useCallback(async (_e, edge) => {
    if (!graph) return;
    const matched = graph.edges.find(
      (g) => edgeKey(g.from, g.to, g.label) === edge.id,
    );
    if (!matched) return;
    const next = window.prompt("New edge label (empty to clear)", matched.label ?? "");
    if (next === null) return;
    const newLabel = next.trim().length > 0 ? next.trim() : null;
    if (newLabel === matched.label) return;
    setBusy(true);
    try {
      const res = await relabelEdge({
        promptId,
        version,
        fromNodeId: matched.from,
        toNodeId: matched.to,
        oldLabel: matched.label,
        newLabel,
      });
      onMutated(res, "Edge relabelled");
    } catch (err) {
      handleError(err, "Failed to relabel edge");
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, promptId, version, relabelEdge]);

  const handleRemoveNode = async () => {
    if (!renameTarget) return;
    if (!window.confirm(`Remove node ${renameTarget.id} (${renameTarget.label})?`)) return;
    setBusy(true);
    try {
      const res = await removeNode({ promptId, version, nodeId: renameTarget.id });
      closeRename();
      onMutated(res, "Node removed");
    } catch (err) {
      handleError(err, "Failed to remove node");
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveEdgeFromMenu = async (
    fromId: string,
    toId: string,
    label: string | null,
  ) => {
    setBusy(true);
    try {
      const res = await removeEdge({
        promptId,
        version,
        fromNodeId: fromId,
        toNodeId: toId,
        label,
      });
      onMutated(res, "Edge removed");
    } catch (err) {
      handleError(err, "Failed to remove edge");
    } finally {
      setBusy(false);
    }
  };

  // The backend validates mermaid before persistence, so a parse
  // failure on read is structural — render a fallback rather than
  // crash so the user can still inspect/repair via Text mode.
  if (!graph) {
    return (
      <Text size="sm" c="dimmed">
        Graph could not be parsed. Switch to Text mode to inspect the mermaid source.
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Text size="xs" c="dimmed">
          Double-click a node to rename · drag from a handle to draw an edge ·
          double-click an edge to relabel · select an edge and press Backspace to remove
        </Text>
        <Button size="xs" disabled={busy} onClick={openAdd}>
          Add node
        </Button>
      </Group>
      <div style={{ width: "100%", height: "60vh", border: "1px solid #1f2937", borderRadius: 6 }}>
        <ReactFlow
          nodes={liveNodes}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onNodeDoubleClick={onNodeDoubleClick}
          onEdgeDoubleClick={onEdgeDoubleClick}
          onEdgesDelete={(deleted) => {
            if (!graph) return;
            for (const e of deleted) {
              const matched = graph.edges.find(
                (g) => edgeKey(g.from, g.to, g.label) === e.id,
              );
              if (matched) {
                void handleRemoveEdgeFromMenu(matched.from, matched.to, matched.label);
              }
            }
          }}
          connectionMode={ConnectionMode.Loose}
          // Drag is enabled; positions are persisted via the layout
          // endpoint without forking the version (presentation
          // metadata, not graph identity).
          nodesDraggable
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>

      <Modal opened={renameOpened} onClose={closeRename} title="Rename node" size="sm">
        <Stack>
          <VariableAwareInput
            label="Label"
            value={renameDraft}
            onChange={setRenameDraft}
            variables={variables}
            onCreateVariable={(name) =>
              setRenameNewVars((prev) => stageNewVar(prev, name))
            }
            autoFocus
          />
          {renameNewVars.length > 0 && (
            <Text size="xs" c="dimmed">
              New variables to declare: {renameNewVars.map((n) => `{{${n}}}`).join(", ")}
            </Text>
          )}
          <Group justify="space-between">
            <Button color="red" variant="subtle" onClick={() => void handleRemoveNode()}>
              Remove node
            </Button>
            <Group>
              <Button variant="subtle" onClick={closeRename}>
                Cancel
              </Button>
              <Button loading={busy} onClick={() => void handleRenameSubmit()}>
                Save
              </Button>
            </Group>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={addOpened} onClose={closeAdd} title="Add node" size="sm">
        <Stack>
          <VariableAwareInput
            label="Label"
            placeholder="e.g. Verify result"
            value={addLabel}
            onChange={setAddLabel}
            variables={variables}
            onCreateVariable={(name) =>
              setAddNewVars((prev) => stageNewVar(prev, name))
            }
            autoFocus
          />
          {addNewVars.length > 0 && (
            <Text size="xs" c="dimmed">
              New variables to declare: {addNewVars.map((n) => `{{${n}}}`).join(", ")}
            </Text>
          )}
          <Select
            label="Kind"
            data={BRAID_NODE_KINDS.map((k) => ({ value: k, label: k }))}
            value={addKind}
            onChange={(v) => setAddKind((v as BraidNodeKind) ?? "step")}
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={closeAdd}>
              Cancel
            </Button>
            <Button loading={busy} onClick={() => void handleAddSubmit()}>
              Add
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};
