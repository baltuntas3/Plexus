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
  Title,
} from "@mantine/core";
import { useSetAtom } from "jotai";
import { useNavigate, useParams } from "react-router-dom";
import { DiffEditor, Editor } from "@monaco-editor/react";
import { notifications } from "@mantine/notifications";
import type { GraphQualityScoreDto, PromptVersionDto, VersionStatus } from "@plexus/shared-types";
import {
  createVersionAtom,
  fetchPromptDetailAtom,
  promptDetailRefreshAtom,
} from "../atoms/prompts.atoms.js";
import { useAtomValue } from "jotai";
import { lintVersionAtom } from "../atoms/braid.atoms.js";
import { BraidView } from "../components/braid-view.js";
import { LintPanel } from "../components/lint-panel.js";
import { GenerateBraidModal } from "../components/generate-braid-modal.js";
import { ApiError } from "../lib/api-client.js";

const statusColor: Record<VersionStatus, string> = {
  draft: "gray",
  staging: "yellow",
  production: "green",
};

export const VersionDetailPage = () => {
  const { id, version } = useParams<{ id: string; version: string }>();
  const navigate = useNavigate();
  const fetchDetail = useSetAtom(fetchPromptDetailAtom);
  const lint = useSetAtom(lintVersionAtom);
  const createVersion = useSetAtom(createVersionAtom);
  const refresh = useAtomValue(promptDetailRefreshAtom);
  const [current, setCurrent] = useState<PromptVersionDto | null>(null);
  const [allVersions, setAllVersions] = useState<PromptVersionDto[]>([]);
  const [compareTo, setCompareTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [braidModalOpen, setBraidModalOpen] = useState(false);
  const [qualityScore, setQualityScore] = useState<GraphQualityScoreDto | null>(null);
  const [linting, setLinting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [saving, setSaving] = useState(false);

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
    fetchDetail(id)
      .then((d) => {
        if (cancelled) return;
        setAllVersions(d.versions);
        const found = d.versions.find((v) => v.version === version) ?? null;
        setCurrent(found);
        setDraftContent(found?.classicalPrompt ?? "");
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

  if (loading) {
    return <Center py="xl"><Loader /></Center>;
  }
  if (!current || !id) {
    return <Text>Version not found</Text>;
  }

  const compareVersion = allVersions.find((v) => v.version === compareTo) ?? null;

  return (
    <Stack>
      <Group justify="space-between">
        <Group>
          <Title order={2}>{current.version}</Title>
          <Badge color={statusColor[current.status]}>{current.status}</Badge>
          {current.braidGraph && <Badge color="violet">BRAID</Badge>}
        </Group>
        <Group>
          <Button onClick={() => setBraidModalOpen(true)}>
            {current.braidGraph ? "Regenerate BRAID" : "Generate BRAID"}
          </Button>
          <Button variant="subtle" onClick={() => navigate(`/prompts/${id}`)}>
            Back
          </Button>
        </Group>
      </Group>

      <Tabs defaultValue={current.braidGraph ? "braid" : "classical"}>
        <Tabs.List>
          <Tabs.Tab value="classical">Classical Prompt</Tabs.Tab>
          <Tabs.Tab value="braid" disabled={!current.braidGraph}>
            BRAID Graph
          </Tabs.Tab>
        </Tabs.List>

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
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  renderSideBySide: true,
                }}
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

        <Tabs.Panel value="braid" pt="md">
          {current.braidGraph ? (
            <Stack>
              <Group justify="space-between">
                <Group>
                  {current.generatorModel && (
                    <Badge variant="light">generator: {current.generatorModel}</Badge>
                  )}
                </Group>
                <Button
                  size="xs"
                  variant="light"
                  loading={linting}
                  onClick={() => id && runLint(id, current.version)}
                >
                  Re-lint
                </Button>
              </Group>
              <Grid>
                <Grid.Col span={{ base: 12, md: 7 }}>
                  <Stack>
                    <BraidView mermaidCode={current.braidGraph} />
                    <Paper withBorder p={0} style={{ overflow: "hidden" }}>
                      <Editor
                        height="30vh"
                        defaultLanguage="plaintext"
                        value={current.braidGraph}
                        theme="vs-dark"
                        options={{
                          readOnly: true,
                          minimap: { enabled: false },
                          wordWrap: "on",
                          fontSize: 12,
                        }}
                      />
                    </Paper>
                  </Stack>
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 5 }}>
                  {qualityScore ? (
                    <LintPanel qualityScore={qualityScore} />
                  ) : (
                    <Center py="lg">
                      <Loader size="sm" />
                    </Center>
                  )}
                </Grid.Col>
              </Grid>
            </Stack>
          ) : (
            <Text c="dimmed">No BRAID graph yet. Click "Generate BRAID" to create one.</Text>
          )}
        </Tabs.Panel>
      </Tabs>

      <GenerateBraidModal
        opened={braidModalOpen}
        onClose={() => setBraidModalOpen(false)}
        promptId={id}
        version={current.version}
      />
    </Stack>
  );
};
