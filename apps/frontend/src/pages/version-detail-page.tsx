import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Center,
  Checkbox,
  Grid,
  Group,
  Loader,
  MultiSelect,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { useSetAtom, useAtomValue } from "jotai";
import { useNavigate, useParams } from "react-router-dom";
import { DiffEditor, Editor } from "@monaco-editor/react";
import { notifications } from "@mantine/notifications";
import type { GraphQualityScoreDto, PromptDto, PromptVersionDto, VersionStatus } from "@plexus/shared-types";
import {
  createVersionAtom,
  fetchPromptDetailAtom,
  promptDetailRefreshAtom,
  updateVersionNameAtom,
} from "../atoms/prompts.atoms.js";
import { createBenchmarkAtom } from "../atoms/benchmarks.atoms.js";
import { chatBraidAtom, lintVersionAtom, modelsAtom, updateBraidAtom } from "../atoms/braid.atoms.js";
import { BraidView } from "../components/braid-view.js";
import { LintPanel } from "../components/lint-panel.js";
import { DEFAULT_TEST_COUNT } from "../lib/evaluate-presets.js";
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
  onResult: (mermaidCode: string, qualityScore: GraphQualityScoreDto, newVersion: string | null) => void;
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

      if (result.type === "question") {
        const agentMsg: ChatMessage = { role: "agent", content: result.question };
        setMessages((prev) => [...prev, agentMsg]);
      } else {
        const label = result.newVersion
          ? `Created ${result.newVersion} — ${result.qualityScore.overall.toFixed(0)}/100 quality · $${result.usage.totalUsd.toFixed(4)}`
          : `Graph updated — ${result.qualityScore.overall.toFixed(0)}/100 quality · $${result.usage.totalUsd.toFixed(4)}`;
        const agentMsg: ChatMessage = { role: "agent", content: label };
        setMessages((prev) => [...prev, agentMsg]);
        onResult(result.mermaidCode, result.qualityScore, result.newVersion);
      }
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

interface EvaluatePanelProps {
  currentVersion: PromptVersionDto;
  versions: PromptVersionDto[];
  promptName: string;
  productionVersionName: string | null;
}

const SolverMultiSelect = ({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) => {
  const models = useAtomValue(modelsAtom);
  return (
    <MultiSelect
      label="Solver models"
      description="Models that will answer each test case. Picked head-to-head."
      placeholder="Pick one or more models"
      value={value}
      onChange={onChange}
      data={models.map((m) => ({
        value: m.id,
        label: `${m.displayName} ($${m.inputPricePerMillion}/$${m.outputPricePerMillion}/1M)`,
      }))}
      searchable
      clearable
    />
  );
};

const EvaluatePanel = ({
  currentVersion,
  versions,
  promptName,
  productionVersionName,
}: EvaluatePanelProps) => {
  const createBenchmark = useSetAtom(createBenchmarkAtom);
  const navigate = useNavigate();

  const defaultVersionIds = useMemo(() => {
    const ids = new Set<string>([currentVersion.id]);
    if (productionVersionName) {
      const production = versions.find((v) => v.version === productionVersionName);
      if (production && production.id !== currentVersion.id) {
        ids.add(production.id);
      }
    }
    return Array.from(ids);
  }, [currentVersion.id, productionVersionName, versions]);

  const [selectedVersionIds, setSelectedVersionIds] = useState<string[]>(defaultVersionIds);
  const [solverModels, setSolverModels] = useState<string[]>([]);
  const [testCount, setTestCount] = useState<number>(DEFAULT_TEST_COUNT);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setSelectedVersionIds(defaultVersionIds);
  }, [defaultVersionIds]);

  const toggleVersion = (id: string, checked: boolean) => {
    setSelectedVersionIds((prev) => {
      if (checked) return prev.includes(id) ? prev : [...prev, id];
      return prev.filter((x) => x !== id);
    });
  };

  const handleStart = async () => {
    if (selectedVersionIds.length === 0) {
      notifications.show({
        color: "yellow",
        title: "Version required",
        message: "Pick at least one version to benchmark",
      });
      return;
    }
    if (solverModels.length === 0) {
      notifications.show({
        color: "yellow",
        title: "Model required",
        message: "Pick at least one solver model",
      });
      return;
    }
    if (!Number.isFinite(testCount) || testCount < 1 || testCount > 50) {
      notifications.show({
        color: "yellow",
        title: "Invalid test count",
        message: "Test case count must be between 1 and 50",
      });
      return;
    }

    setSubmitting(true);
    try {
      const benchmark = await createBenchmark({
        name: `${promptName} · ${solverModels.join(", ")} · ${testCount} cases`,
        promptVersionIds: selectedVersionIds,
        solverModels,
        testCount,
      });
      notifications.show({
        color: "green",
        title: "Evaluation ready",
        message: `${benchmark.testCases.length} test cases generated for ${selectedVersionIds.length} version(s)`,
      });
      navigate(`/benchmarks/${benchmark.id}`, {
        state: {
          returnTo: `/prompts/${currentVersion.promptId}/versions/${currentVersion.version}`,
        },
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to create evaluation";
      notifications.show({ color: "red", title: "Error", message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Stack gap="md">
      <Paper withBorder p="lg">
        <Stack gap="md">
          <div>
            <Title order={4}>Evaluate Versions</Title>
            <Text size="sm" c="dimmed">
              Pick which versions to compare, which models to evaluate as solvers, and how many
              test cases to generate. Judges, generator, generation mode, analysis model,
              repetitions and seed are chosen server-side to keep the comparison fair.
            </Text>
          </div>

          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Versions
            </Text>
            <Text size="xs" c="dimmed">
              Select one or more versions of this prompt to benchmark head-to-head.
            </Text>
            <Stack gap={4} mt={4}>
              {versions.map((v) => {
                const isProduction = v.version === productionVersionName;
                const isCurrent = v.id === currentVersion.id;
                return (
                  <Checkbox
                    key={v.id}
                    size="sm"
                    checked={selectedVersionIds.includes(v.id)}
                    onChange={(e) => toggleVersion(v.id, e.currentTarget.checked)}
                    label={
                      <Group gap={6}>
                        <Text size="sm">{v.version}</Text>
                        {isCurrent && <Badge size="xs" color="blue">current</Badge>}
                        {isProduction && <Badge size="xs" color="green">production</Badge>}
                        <Badge size="xs" color="gray" variant="light">
                          {v.braidGraph ? "BRAID" : "classical"}
                        </Badge>
                      </Group>
                    }
                  />
                );
              })}
            </Stack>
          </Stack>

          <Suspense fallback={<Loader size="xs" />}>
            <SolverMultiSelect value={solverModels} onChange={setSolverModels} />
          </Suspense>

          <NumberInput
            label="Test Case Count"
            description="The generator creates this many shared evaluation cases before you review/edit them."
            min={1}
            max={50}
            value={testCount}
            onChange={(value) => setTestCount(typeof value === "number" ? value : DEFAULT_TEST_COUNT)}
          />

          <Group justify="flex-end">
            <Button
              onClick={() => void handleStart()}
              loading={submitting}
              disabled={selectedVersionIds.length === 0 || solverModels.length === 0}
            >
              Generate Evaluation Cases
            </Button>
          </Group>
        </Stack>
      </Paper>
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
  const updateVersionName = useSetAtom(updateVersionNameAtom);
  const refresh = useAtomValue(promptDetailRefreshAtom);
  const [current, setCurrent] = useState<PromptVersionDto | null>(null);
  const [allVersions, setAllVersions] = useState<PromptVersionDto[]>([]);
  const [prompt, setPrompt] = useState<PromptDto | null>(null);
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
  const [renamingName, setRenamingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);

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
        setPrompt(d.prompt);
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

  // Called by ChatPanel when the agent successfully returns a new graph.
  // When initial generation created a new version, navigate there so the user
  // is always looking at the canonical BRAID version.
  const handleChatResult = (mermaidCode: string, score: GraphQualityScoreDto, newVersion: string | null) => {
    if (newVersion && id) {
      navigate(`/prompts/${id}/versions/${newVersion}`);
      return;
    }
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
  const hasBraid = Boolean(liveMermaid ?? current.braidGraph);
  const compareVersion = allVersions.find((v) => v.version === compareTo) ?? null;

  const startRenaming = () => {
    setNameDraft(current.name ?? "");
    setRenamingName(true);
  };

  const cancelRenaming = () => {
    setRenamingName(false);
    setNameDraft("");
  };

  const commitRename = async () => {
    if (!id) return;
    const trimmed = nameDraft.trim();
    // Clear the name by sending null when the field is empty — the API treats
    // that as "revert to auto-generated version label".
    const payload = trimmed.length > 0 ? trimmed : null;
    if ((payload ?? null) === (current.name ?? null)) {
      cancelRenaming();
      return;
    }
    setSavingName(true);
    try {
      const updated = await updateVersionName({
        promptId: id,
        version: current.version,
        input: { name: payload },
      });
      setCurrent(updated);
      setRenamingName(false);
      notifications.show({
        color: "green",
        title: "Name saved",
        message: payload ? `Version renamed to "${payload}"` : "Version name cleared",
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to rename";
      notifications.show({ color: "red", title: "Error", message });
    } finally {
      setSavingName(false);
    }
  };

  const displayName = current.name?.trim() || current.version;

  return (
    <Stack>
      <Group justify="space-between">
        <Group>
          {renamingName ? (
            <Group gap="xs">
              <TextInput
                autoFocus
                size="sm"
                value={nameDraft}
                placeholder="Version name (leave empty to clear)"
                onChange={(e) => setNameDraft(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commitRename();
                  if (e.key === "Escape") cancelRenaming();
                }}
                maxLength={80}
                style={{ minWidth: 260 }}
              />
              <Button size="xs" loading={savingName} onClick={commitRename}>
                Save
              </Button>
              <Button size="xs" variant="subtle" onClick={cancelRenaming}>
                Cancel
              </Button>
            </Group>
          ) : (
            <Group gap="xs">
              <Title order={2}>{displayName}</Title>
              {current.name && (
                <Text c="dimmed" size="sm">
                  ({current.version})
                </Text>
              )}
              <Button size="xs" variant="subtle" onClick={startRenaming}>
                Rename
              </Button>
            </Group>
          )}
          <Badge color={statusColor[current.status]}>{current.status}</Badge>
          {(liveMermaid ?? current.braidGraph) && <Badge color="violet">BRAID</Badge>}
        </Group>
        <Button variant="subtle" onClick={() => navigate(`/prompts/${id}`)}>
          Back
        </Button>
      </Group>

      <Tabs defaultValue={hasBraid ? "braid" : "classical"}>
        <Tabs.List>
          {!hasBraid && <Tabs.Tab value="classical">Classical Prompt</Tabs.Tab>}
          <Tabs.Tab value="braid">BRAID Graph</Tabs.Tab>
          <Tabs.Tab value="evaluate">Evaluate</Tabs.Tab>
        </Tabs.List>

        {/* ── Classical tab ─────────────────────────────────────────────── */}
        {!hasBraid && (
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
                  .map((v) => ({
                    value: v.version,
                    label: v.name?.trim() ? `${v.name} (${v.version})` : v.version,
                  }))}
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
        )}

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

        <Tabs.Panel value="evaluate" pt="md">
          <EvaluatePanel
            currentVersion={current}
            versions={allVersions}
            promptName={prompt?.name ?? "Prompt"}
            productionVersionName={prompt?.productionVersion ?? null}
          />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
};
