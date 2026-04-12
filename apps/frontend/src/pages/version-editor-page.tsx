import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Center,
  Grid,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useAtomValue, useSetAtom } from "jotai";
import { useNavigate, useParams } from "react-router-dom";
import { Editor } from "@monaco-editor/react";
import { notifications } from "@mantine/notifications";
import {
  createVersionAtom,
  fetchPromptDetailAtom,
} from "../atoms/prompts.atoms.js";
import {
  clearDraftAtom,
  draftAtomFamily,
  initDraftAtom,
  snapshotDraftAtom,
  updateDraftCurrentAtom,
} from "../atoms/draft-history.atoms.js";
import { DraftHistoryPanel } from "../components/draft-history-panel.js";
import { ApiError } from "../lib/api-client.js";

const SNAPSHOT_DEBOUNCE_MS = 1500;

interface EditorViewProps {
  promptId: string;
}

const EditorView = ({ promptId }: EditorViewProps) => {
  const navigate = useNavigate();
  const fetchDetail = useSetAtom(fetchPromptDetailAtom);
  const createVersion = useSetAtom(createVersionAtom);
  const initDraft = useSetAtom(initDraftAtom);
  const updateDraftCurrent = useSetAtom(updateDraftCurrentAtom);
  const snapshotDraft = useSetAtom(snapshotDraftAtom);
  const clearDraft = useSetAtom(clearDraftAtom);

  const draftAtom = useMemo(() => draftAtomFamily(promptId), [promptId]);
  const draft = useAtomValue(draftAtom);

  const [initializing, setInitializing] = useState(true);
  const [saving, setSaving] = useState(false);
  const [debouncedContent] = useDebouncedValue(draft?.current ?? "", SNAPSHOT_DEBOUNCE_MS);

  useEffect(() => {
    let cancelled = false;
    fetchDetail(promptId)
      .then((d) => {
        if (cancelled) return;
        const latest = d.versions[0];
        const baseContent = latest?.classicalPrompt ?? "";
        initDraft({ promptId, baseContent });
      })
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? err.message : "Failed to load";
        notifications.show({ color: "red", title: "Error", message });
      })
      .finally(() => {
        if (!cancelled) setInitializing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [promptId, fetchDetail, initDraft]);

  useEffect(() => {
    if (!draft) return;
    snapshotDraft(promptId);
  }, [debouncedContent, draft, promptId, snapshotDraft]);

  const handleEditorChange = (value: string | undefined) => {
    updateDraftCurrent({ promptId, content: value ?? "" });
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const version = await createVersion({
        promptId,
        input: { classicalPrompt: draft.current },
      });
      notifications.show({ color: "green", title: "Saved", message: `Created ${version.version}` });
      clearDraft(promptId);
      navigate(`/prompts/${promptId}`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to save";
      notifications.show({ color: "red", title: "Error", message });
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    clearDraft(promptId);
    navigate(`/prompts/${promptId}`);
  };

  if (initializing || !draft) {
    return <Center py="xl"><Loader /></Center>;
  }

  const isDirty = draft.current !== draft.baseContent;

  return (
    <Stack>
      <Group justify="space-between">
        <Group>
          <Title order={2}>New Version</Title>
          {isDirty && <Badge color="yellow">Unsaved draft</Badge>}
        </Group>
        <Group>
          <Button variant="subtle" color="red" onClick={handleDiscard}>
            Discard draft
          </Button>
          <Button onClick={handleSave} loading={saving} disabled={!isDirty}>
            Save as new version
          </Button>
        </Group>
      </Group>
      <Text c="dimmed" size="sm">
        Edits auto-snapshot after {SNAPSHOT_DEBOUNCE_MS / 1000}s of inactivity. Last 20 snapshots are kept.
      </Text>

      <Grid>
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Paper withBorder p={0} style={{ overflow: "hidden" }}>
            <Editor
              height="65vh"
              defaultLanguage="markdown"
              value={draft.current}
              onChange={handleEditorChange}
              theme="vs-dark"
              options={{ minimap: { enabled: false }, wordWrap: "on", fontSize: 14 }}
            />
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <DraftHistoryPanel promptId={promptId} />
        </Grid.Col>
      </Grid>
    </Stack>
  );
};

export const VersionEditorPage = () => {
  const { id } = useParams<{ id: string }>();
  if (!id) {
    return <Text>Invalid route</Text>;
  }
  return <EditorView promptId={id} />;
};
