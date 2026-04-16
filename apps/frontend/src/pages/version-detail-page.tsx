import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Center,
  Grid,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Tabs,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { useSetAtom, useAtomValue } from "jotai";
import { useNavigate, useParams } from "react-router-dom";
import { DiffEditor, Editor } from "@monaco-editor/react";
import { notifications } from "@mantine/notifications";
import type { GraphQualityScoreDto, PromptVersionDto, VersionStatus } from "@plexus/shared-types";
import {
  createVersionAtom,
  fetchPromptDetailAtom,
  promptDetailRefreshAtom,
} from "../atoms/prompts.atoms.js";
import { chatBraidAtom, lintVersionAtom, modelsAtom, updateBraidAtom } from "../atoms/braid.atoms.js";
import { BraidView } from "../components/braid-view.js";
import { LintPanel } from "../components/lint-panel.js";
import { ApiError } from "../lib/api-client.js";

const statusColor: Record<VersionStatus, string> = {
  draft: "gray",
  staging: "yellow",
  production: "green",
};

interface ChatMessage {
  role: "user" | "agent";
  content: string;
}

// ── Model picker (needs Suspense because modelsAtom is async) ────────────────

const ModelSelect = ({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) => {
  const models = useAtomValue(modelsAtom);
  return (
    <Select
      placeholder="Select model"
      size="xs"
      value={value}
      onChange={onChange}
      data={models.map((m) => ({
        value: m.id,
        label: `${m.displayName} ($${m.inputPricePerMillion}/$${m.outputPricePerMillion}/1M)`,
      }))}
      searchable
      style={{ minWidth: 220 }}
    />
  );
};

// ── Chat panel ────────────────────────────────────────────────────────────────

interface ChatPanelProps {
  promptId: string;
  version: string;
  currentMermaid: string | null;
  onResult: (mermaidCode: string, qualityScore: GraphQualityScoreDto) => void;
}

const ChatPanel = ({ promptId, version, currentMermaid, onResult }: ChatPanelProps) => {
  const chat = useSetAtom(chatBraidAtom);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: "smooth" });
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !model) {
      if (!model) notifications.show({ color: "yellow", title: "Model required", message: "Pick a generator model" });
      return;
    }

    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const result = await chat({
        promptId,
        version,
        body: {
          userMessage: text,
          generatorModel: model,
          currentMermaid: currentMermaid ?? undefined,
        },
      });

      const agentMsg: ChatMessage = {
        role: "agent",
        content: `Graph updated — ${result.qualityScore.overall.toFixed(0)}/100 quality · $${result.usage.totalUsd.toFixed(4)}`,
      };
      setMessages((prev) => [...prev, agentMsg]);
      onResult(result.mermaidCode, result.qualityScore);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Agent failed";
      const errMsg: ChatMessage = { role: "agent", content: `Error: ${message}` };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setLoading(false);
      setTimeout(scrollToBottom, 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <Stack gap="xs" h="100%" style={{ display: "flex", flexDirection: "column" }}>
      <Group justify="space-between" wrap="nowrap">
        <Text size="sm" fw={600}>
          BRAID Agent
        </Text>
        <Suspense fallback={<Loader size="xs" />}>
          <ModelSelect value={model} onChange={setModel} />
        </Suspense>
      </Group>

      <ScrollArea
        viewportRef={viewport}
        style={{ flex: 1, minHeight: 180 }}
        type="auto"
      >
        {messages.length === 0 ? (
          <Text size="xs" c="dimmed" ta="center" py="lg">
            {currentMermaid
              ? "Describe how to refine the graph, or ask the agent to make changes."
              : "Describe the task and the agent will generate a BRAID graph."}
          </Text>
        ) : (
          <Stack gap={6} px={4}>
            {messages.map((msg, i) => (
              <Paper
                key={i}
                px="sm"
                py={6}
                radius="sm"
                style={{
                  background: msg.role === "user" ? "#1e3a5f" : "#1a2a1a",
                  alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "90%",
                }}
              >
                <Text size="xs" c={msg.role === "user" ? "#93c5fd" : "#86efac"}>
                  {msg.role === "user" ? "You" : "Agent"}
                </Text>
                <Text size="xs" style={{ whiteSpace: "pre-wrap" }}>
                  {msg.content}
                </Text>
              </Paper>
            ))}
            {loading && (
              <Group gap="xs" px={4}>
                <Loader size="xs" />
                <Text size="xs" c="dimmed">Agent is thinking…</Text>
              </Group>
            )}
          </Stack>
        )}
      </ScrollArea>

      <Group gap="xs" wrap="nowrap" align="flex-end">
        <Textarea
          style={{ flex: 1 }}
          size="xs"
          placeholder={currentMermaid ? "Refine the graph…" : "Describe the BRAID you want…"}
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          autosize
          minRows={1}
          maxRows={4}
          disabled={loading}
        />
        <ActionIcon
          variant="filled"
          size="lg"
          onClick={() => void handleSend()}
          loading={loading}
          disabled={!input.trim() || !model}
        >
          ↑
        </ActionIcon>
      </Group>
    </Stack>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────

export const VersionDetailPage = () => {
  const { id, version } = useParams<{ id: string; version: string }>();
  const navigate = useNavigate();
  const fetchDetail = useSetAtom(fetchPromptDetailAtom);
  const lint = useSetAtom(lintVersionAtom);
  const updateBraid = useSetAtom(updateBraidAtom);
  const createVersion = useSetAtom(createVersionAtom);
  const refresh = useAtomValue(promptDetailRefreshAtom);
  const [current, setCurrent] = useState<PromptVersionDto | null>(null);
  const [allVersions, setAllVersions] = useState<PromptVersionDto[]>([]);
  const [compareTo, setCompareTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [qualityScore, setQualityScore] = useState<GraphQualityScoreDto | null>(null);
  const [linting, setLinting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingBraid, setEditingBraid] = useState(false);
  const [braidDraft, setBraidDraft] = useState("");
  const [savingBraid, setSavingBraid] = useState(false);
  // liveMermaid mirrors the current displayed graph (updated by chat without page reload)
  const [liveMermaid, setLiveMermaid] = useState<string | null>(null);

  const runLint = useCallback(
    async (promptId: string, versionName: string): Promise<void> => {
      setLinting(true);
      try {
        const score = await lint({ promptId, version: versionName });
        setQualityScore(score);
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "Failed to lint";
        notifications.show({ color: "red", title: "Error", message });
      } finally {
        setLinting(false);
      }
    },
    [lint],
  );

  useEffect(() => {
    if (!id || !version) return;
    let cancelled = false;
    setLoading(true);
    setQualityScore(null);
    setEditing(false);
    setEditingBraid(false);
    fetchDetail(id)
      .then((d) => {
        if (cancelled) return;
        setAllVersions(d.versions);
        const found = d.versions.find((v) => v.version === version) ?? null;
        setCurrent(found);
        setDraftContent(found?.classicalPrompt ?? "");
        setBraidDraft(found?.braidGraph ?? "");
        setLiveMermaid(found?.braidGraph ?? null);
        if (found?.braidGraph) {
          void runLint(id, version);
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? err.message : "Failed to load";
        notifications.show({ color: "red", title: "Error", message });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, version, fetchDetail, refresh, runLint]);

  const handleSaveAsNewVersion = async () => {
    if (!id) return;
    setSaving(true);
    try {
      const newVersion = await createVersion({
        promptId: id,
        input: { classicalPrompt: draftContent },
      });
      notifications.show({
        color: "green",
        title: "New version saved",
        message: `Created ${newVersion.version}`,
      });
      setEditing(false);
      navigate(`/prompts/${id}/versions/${newVersion.version}`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to save";
      notifications.show({ color: "red", title: "Error", message });
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setDraftContent(current?.classicalPrompt ?? "");
    setEditing(false);
  };

  const handleSaveBraid = async () => {
    if (!id || !current) return;
    setSavingBraid(true);
    try {
      const score = await updateBraid({
        promptId: id,
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
    setBraidDraft(liveMermaid ?? current?.braidGraph ?? "");
    setEditingBraid(false);
  };

  // Called by ChatPanel when the agent successfully returns a new graph
  const handleChatResult = (mermaidCode: string, score: GraphQualityScoreDto) => {
    setLiveMermaid(mermaidCode);
    setBraidDraft(mermaidCode);
    setQualityScore(score);
  };

  if (loading) {
    return <Center py="xl"><Loader /></Center>;
  }
  if (!current || !id) {
    return <Text>Version not found</Text>;
  }

  const displayMermaid = editingBraid ? braidDraft : (liveMermaid ?? current.braidGraph ?? "");
  const compareVersion = allVersions.find((v) => v.version === compareTo) ?? null;

  return (
    <Stack>
      <Group justify="space-between">
        <Group>
          <Title order={2}>{current.version}</Title>
          <Badge color={statusColor[current.status]}>{current.status}</Badge>
          {(liveMermaid ?? current.braidGraph) && <Badge color="violet">BRAID</Badge>}
        </Group>
        <Button variant="subtle" onClick={() => navigate(`/prompts/${id}`)}>
          Back
        </Button>
      </Group>

      <Tabs defaultValue={(liveMermaid ?? current.braidGraph) ? "braid" : "classical"}>
        <Tabs.List>
          <Tabs.Tab value="classical">Classical Prompt</Tabs.Tab>
          <Tabs.Tab value="braid">BRAID Graph</Tabs.Tab>
        </Tabs.List>

        {/* ── Classical tab ─────────────────────────────────────────────── */}
        <Tabs.Panel value="classical" pt="md">
          <Group mb="sm" justify="space-between">
            <Select
              label="Compare with"
              placeholder="Select version"
              value={compareTo}
              onChange={setCompareTo}
              clearable
              disabled={editing}
              data={allVersions
                .filter((v) => v.version !== current.version)
                .map((v) => ({ value: v.version, label: v.version }))}
              w={200}
            />
            {!editing && (
              <Button variant="light" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {editing && (
              <Group>
                <Button variant="subtle" onClick={handleCancelEdit}>
                  Cancel
                </Button>
                <Button
                  loading={saving}
                  onClick={handleSaveAsNewVersion}
                  disabled={draftContent === current.classicalPrompt}
                >
                  Save as new version
                </Button>
              </Group>
            )}
          </Group>
          <Paper withBorder p={0} style={{ overflow: "hidden" }}>
            {compareVersion && !editing ? (
              <DiffEditor
                height="60vh"
                original={compareVersion.classicalPrompt}
                modified={current.classicalPrompt}
                language="markdown"
                theme="vs-dark"
                options={{ readOnly: true, minimap: { enabled: false }, renderSideBySide: true }}
              />
            ) : (
              <Editor
                key={editing ? "edit-mode" : "view-mode"}
                height="60vh"
                defaultLanguage="markdown"
                value={editing ? draftContent : current.classicalPrompt}
                onChange={editing ? (v) => setDraftContent(v ?? "") : undefined}
                theme="vs-dark"
                options={{
                  readOnly: !editing,
                  minimap: { enabled: false },
                  wordWrap: "on",
                  fontSize: 14,
                }}
              />
            )}
          </Paper>
        </Tabs.Panel>

        {/* ── BRAID tab ─────────────────────────────────────────────────── */}
        <Tabs.Panel value="braid" pt="md">
          <Grid>
            {/* Left: diagram + editor */}
            <Grid.Col span={{ base: 12, md: displayMermaid ? 7 : 12 }}>
              {displayMermaid ? (
                <Stack>
                  <Group justify="space-between">
                    <Group gap="xs">
                      {current.generatorModel && (
                        <Badge variant="light" size="sm">
                          generator: {current.generatorModel}
                        </Badge>
                      )}
                    </Group>
                    <Group gap="xs">
                      {!editingBraid ? (
                        <>
                          <Button
                            size="xs"
                            variant="subtle"
                            loading={linting}
                            onClick={() => id && runLint(id, current.version)}
                          >
                            Re-lint
                          </Button>
                          <Button
                            size="xs"
                            variant="light"
                            onClick={() => setEditingBraid(true)}
                          >
                            Edit Mermaid
                          </Button>
                        </>
                      ) : (
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

                  <BraidView mermaidCode={displayMermaid} />

                  <Paper withBorder p={0} style={{ overflow: "hidden" }}>
                    <Editor
                      key={editingBraid ? "edit-braid" : "view-braid"}
                      height="25vh"
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
                </Stack>
              ) : (
                <Center py="xl">
                  <Text c="dimmed">
                    No BRAID graph yet. Use the agent to generate one.
                  </Text>
                </Center>
              )}
            </Grid.Col>

            {/* Right: lint + chat */}
            <Grid.Col span={{ base: 12, md: displayMermaid ? 5 : 12 }}>
              <Stack h="100%" gap="md">
                {qualityScore && displayMermaid && (
                  <LintPanel qualityScore={qualityScore} />
                )}
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
                  <ChatPanel
                    promptId={id}
                    version={current.version}
                    currentMermaid={liveMermaid ?? current.braidGraph}
                    onResult={handleChatResult}
                  />
                </Paper>
              </Stack>
            </Grid.Col>
          </Grid>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
};
