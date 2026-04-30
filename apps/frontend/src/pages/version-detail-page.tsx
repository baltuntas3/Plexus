import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Center,
  Grid,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { useAtomValue, useSetAtom } from "jotai";
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
import { lintVersionAtom, updateBraidAtom } from "../atoms/braid.atoms.js";
import { BraidChatPanel } from "../components/braid-chat-panel.js";
import { BraidView } from "../components/braid-view.js";
import { EvaluatePanel } from "../components/evaluate-panel.js";
import { LintPanel } from "../components/lint-panel.js";
import { ApiError } from "../lib/api-client.js";

const statusColor: Record<VersionStatus, string> = {
  draft: "gray",
  development: "blue",
  staging: "yellow",
  production: "green",
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
        setDraftContent(found?.sourcePrompt ?? "");
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
        input: { sourcePrompt: draftContent },
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
    setDraftContent(current?.sourcePrompt ?? "");
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

      {current.variables.length > 0 && (
        <Paper withBorder p="xs">
          <Group gap="xs" wrap="wrap">
            <Text size="xs" fw={600} c="dimmed">
              Variables:
            </Text>
            {current.variables.map((v) => {
              const detail = [
                v.description,
                v.defaultValue ? `default: ${v.defaultValue}` : null,
              ]
                .filter((s): s is string => Boolean(s))
                .join(" — ");
              const badge = (
                <Badge
                  key={v.name}
                  variant={v.required ? "filled" : "light"}
                  color="violet"
                >
                  {`{{${v.name}}}`}
                  {v.required ? " *" : ""}
                </Badge>
              );
              return detail ? (
                <Tooltip key={v.name} label={detail} multiline maw={300}>
                  {badge}
                </Tooltip>
              ) : (
                badge
              );
            })}
            <Text size="xs" c="dimmed" fs="italic">
              Values are passed at runtime via the SDK.
            </Text>
          </Group>
        </Paper>
      )}

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
                    disabled={draftContent === current.sourcePrompt}
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
                  original={compareVersion.sourcePrompt}
                  modified={current.sourcePrompt}
                  language="markdown"
                  theme="vs-dark"
                  options={{ readOnly: true, minimap: { enabled: false }, renderSideBySide: true }}
                />
              ) : (
                <Editor
                  key={editing ? "edit-mode" : "view-mode"}
                  height="60vh"
                  defaultLanguage="markdown"
                  value={editing ? draftContent : current.sourcePrompt}
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
                  <BraidChatPanel
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
