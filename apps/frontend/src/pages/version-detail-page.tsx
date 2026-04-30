import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Center,
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
import type { PromptDto, PromptVersionDto, VersionStatus } from "@plexus/shared-types";
import {
  createVersionAtom,
  fetchPromptDetailAtom,
  promptDetailRefreshAtom,
  updateVersionNameAtom,
} from "../atoms/prompts.atoms.js";
import { BraidTabPanel } from "../components/braid-tab-panel.js";
import { EvaluatePanel } from "../components/evaluate-panel.js";
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
  const createVersion = useSetAtom(createVersionAtom);
  const updateVersionName = useSetAtom(updateVersionNameAtom);
  const refresh = useAtomValue(promptDetailRefreshAtom);
  const [current, setCurrent] = useState<PromptVersionDto | null>(null);
  const [allVersions, setAllVersions] = useState<PromptVersionDto[]>([]);
  const [prompt, setPrompt] = useState<PromptDto | null>(null);
  const [compareTo, setCompareTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [renamingName, setRenamingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    if (!id || !version) return;
    let cancelled = false;
    setLoading(true);
    setEditing(false);
    fetchDetail(id)
      .then((d) => {
        if (cancelled) return;
        setAllVersions(d.versions);
        setPrompt(d.prompt);
        const found = d.versions.find((v) => v.version === version) ?? null;
        setCurrent(found);
        setDraftContent(found?.sourcePrompt ?? "");
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
  }, [id, version, fetchDetail, refresh]);

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

  if (loading) {
    return <Center py="xl"><Loader /></Center>;
  }
  if (!current || !id) {
    return <Text>Version not found</Text>;
  }

  const hasBraid = Boolean(current.braidGraph);
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
          {current.braidGraph && <Badge color="violet">BRAID</Badge>}
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
          <BraidTabPanel promptId={id} current={current} />
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
