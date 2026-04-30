import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Center,
  Grid,
  Group,
  Loader,
  Paper,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import { Editor } from "@monaco-editor/react";
import { notifications } from "@mantine/notifications";
import { useSetAtom } from "jotai";
import type { GraphQualityScoreDto, PromptVersionDto } from "@plexus/shared-types";
import { lintVersionAtom, updateBraidAtom } from "../atoms/braid.atoms.js";
import { BraidChatPanel } from "./braid-chat-panel.js";
import { BraidView } from "./braid-view.js";
import { BraidVisualEditor } from "./braid-visual-editor.js";
import { LintPanel } from "./lint-panel.js";
import { ApiError } from "../lib/api-client.js";

interface BraidTabPanelProps {
  promptId: string;
  current: PromptVersionDto;
}

type BraidMode = "render" | "visual" | "text";

// Owns the entire BRAID tab: mode toggle (Render / Visual / Text),
// mermaid render, ReactFlow visual editor, Monaco text editor, lint
// panel, and chat panel. State that previously lived on
// `version-detail-page.tsx` (liveMermaid, qualityScore, editingBraid,
// …) is encapsulated here — the page only owns version-loading +
// rename + classical-tab state.
//
// `liveMermaid` mirrors the chat agent's transient diagram suggestion
// before save. After save the page navigates to the new forked
// version, this component remounts with `current.braidGraph` updated,
// and `liveMermaid` resets via the version-change effect.
export const BraidTabPanel = ({ promptId, current }: BraidTabPanelProps) => {
  const lint = useSetAtom(lintVersionAtom);
  const updateBraid = useSetAtom(updateBraidAtom);

  const [liveMermaid, setLiveMermaid] = useState<string | null>(
    current.braidGraph,
  );
  const [qualityScore, setQualityScore] = useState<GraphQualityScoreDto | null>(
    null,
  );
  const [linting, setLinting] = useState(false);
  const [editingBraid, setEditingBraid] = useState(false);
  const [braidDraft, setBraidDraft] = useState(current.braidGraph ?? "");
  const [savingBraid, setSavingBraid] = useState(false);
  const [braidMode, setBraidMode] = useState<BraidMode>("render");

  // Reset state on version change. Re-lint if the new version has a
  // braid graph so the lint panel reflects the right score without
  // requiring the user to click "Re-lint" manually.
  useEffect(() => {
    setLiveMermaid(current.braidGraph);
    setBraidDraft(current.braidGraph ?? "");
    setEditingBraid(false);
    setQualityScore(null);
    if (!current.braidGraph) return;
    let cancelled = false;
    setLinting(true);
    lint({ promptId, version: current.version })
      .then((score) => {
        if (!cancelled) setQualityScore(score);
      })
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? err.message : "Failed to lint";
        notifications.show({ color: "red", title: "Error", message });
      })
      .finally(() => {
        if (!cancelled) setLinting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [current.id, current.braidGraph, current.version, promptId, lint]);

  const handleSaveBraid = async () => {
    setSavingBraid(true);
    try {
      const score = await updateBraid({
        promptId,
        version: current.version,
        mermaidCode: braidDraft,
      });
      setQualityScore(score);
      setLiveMermaid(braidDraft);
      setEditingBraid(false);
      notifications.show({ color: "green", title: "BRAID saved", message: "Graph updated" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save BRAID";
      notifications.show({ color: "red", title: "Error", message });
    } finally {
      setSavingBraid(false);
    }
  };

  const handleCancelEditBraid = () => {
    setBraidDraft(liveMermaid ?? current.braidGraph ?? "");
    setEditingBraid(false);
  };

  // Chat agent returns transient diagram suggestions; we mirror them
  // into local state so the panel renders the new graph without
  // navigating. Persisting the suggestion is a separate explicit
  // action via the chat panel's "Save this version" button.
  const handleChatResult = (
    mermaidCode: string,
    score: GraphQualityScoreDto,
  ) => {
    setLiveMermaid(mermaidCode);
    setBraidDraft(mermaidCode);
    setQualityScore(score);
  };

  const runLint = async (): Promise<void> => {
    setLinting(true);
    try {
      const score = await lint({ promptId, version: current.version });
      setQualityScore(score);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to lint";
      notifications.show({ color: "red", title: "Error", message });
    } finally {
      setLinting(false);
    }
  };

  const displayMermaid = editingBraid
    ? braidDraft
    : (liveMermaid ?? current.braidGraph ?? "");

  return (
    <Grid>
      {/* Left: diagram + editor */}
      <Grid.Col span={{ base: 12, md: displayMermaid ? 7 : 12 }}>
        {displayMermaid ? (
          <Stack>
            <Group justify="space-between" wrap="nowrap">
              <Group gap="xs" wrap="nowrap">
                <SegmentedControl
                  size="xs"
                  value={braidMode}
                  onChange={(v) => {
                    setBraidMode(v as BraidMode);
                    // Leaving text mode discards any in-flight mermaid
                    // edits — the visual editor mutates the server
                    // directly so there's no draft to preserve.
                    if (v !== "text") setEditingBraid(false);
                  }}
                  data={[
                    { value: "render", label: "Render" },
                    { value: "visual", label: "Visual" },
                    { value: "text", label: "Text" },
                  ]}
                />
                {current.generatorModel && (
                  <Badge variant="light" size="sm">
                    generator: {current.generatorModel}
                  </Badge>
                )}
              </Group>
              <Group gap="xs">
                <Button size="xs" variant="subtle" loading={linting} onClick={() => void runLint()}>
                  Re-lint
                </Button>
                {braidMode === "text" && !editingBraid && (
                  <Button size="xs" variant="light" onClick={() => setEditingBraid(true)}>
                    Edit Mermaid
                  </Button>
                )}
                {braidMode === "text" && editingBraid && (
                  <>
                    <Button size="xs" variant="subtle" onClick={handleCancelEditBraid}>
                      Cancel
                    </Button>
                    <Button
                      size="xs"
                      loading={savingBraid}
                      disabled={braidDraft === (liveMermaid ?? current.braidGraph)}
                      onClick={handleSaveBraid}
                    >
                      Save
                    </Button>
                  </>
                )}
              </Group>
            </Group>

            {braidMode === "render" && <BraidView mermaidCode={displayMermaid} />}

            {braidMode === "visual" && displayMermaid && (
              <BraidVisualEditor
                promptId={promptId}
                version={current.version}
                mermaidCode={displayMermaid}
                savedLayout={current.braidGraphLayout}
                variables={current.variables}
              />
            )}

            {braidMode === "text" && (
              <Paper withBorder p={0} style={{ overflow: "hidden" }}>
                <Editor
                  key={editingBraid ? "edit-braid" : "view-braid"}
                  height="60vh"
                  defaultLanguage="plaintext"
                  value={displayMermaid}
                  onChange={editingBraid ? (v) => setBraidDraft(v ?? "") : undefined}
                  theme="vs-dark"
                  options={{
                    readOnly: !editingBraid,
                    minimap: { enabled: false },
                    wordWrap: "on",
                    fontSize: 12,
                  }}
                />
              </Paper>
            )}
          </Stack>
        ) : (
          <Center py="xl">
            <Text c="dimmed">No BRAID graph yet. Use the agent to generate one.</Text>
          </Center>
        )}
      </Grid.Col>

      {/* Right: lint + chat */}
      <Grid.Col span={{ base: 12, md: displayMermaid ? 5 : 12 }}>
        <Stack h="100%" gap="md">
          {qualityScore && displayMermaid && <LintPanel qualityScore={qualityScore} />}
          {linting && !qualityScore && (
            <Center py="sm">
              <Loader size="sm" />
            </Center>
          )}
          <Paper
            withBorder
            p="sm"
            style={{ flex: 1, minHeight: 320, display: "flex", flexDirection: "column" }}
          >
            <BraidChatPanel
              promptId={promptId}
              version={current.version}
              currentMermaid={liveMermaid ?? current.braidGraph}
              onResult={handleChatResult}
            />
          </Paper>
        </Stack>
      </Grid.Col>
    </Grid>
  );
};
