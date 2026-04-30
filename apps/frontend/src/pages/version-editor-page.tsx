import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Center,
  Grid,
  Group,
  Loader,
  Paper,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useAtomValue, useSetAtom } from "jotai";
import { useNavigate, useParams } from "react-router-dom";
import { Editor, type Monaco, type OnMount } from "@monaco-editor/react";
import { notifications } from "@mantine/notifications";
import type { PromptVariableInput } from "@plexus/shared-types";
import {
  createVersionAtom,
  fetchPromptDetailAtom,
} from "../atoms/prompts.atoms.js";
import {
  clearDraftAtom,
  getDraftAtom,
  initDraftAtom,
  snapshotDraftAtom,
  updateDraftCurrentAtom,
} from "../atoms/draft-history.atoms.js";
import { DraftHistoryPanel } from "../components/draft-history-panel.js";
import {
  VariablesPanel,
  validateVariableList,
} from "../components/variables-panel.js";
import { parseVariableReferences } from "../lib/parse-variable-references.js";
import {
  ensurePlaceholderStyles,
  paintPlaceholderDecorations,
  type EditorInstance,
} from "../lib/monaco-placeholder-decorations.js";
import { hasVariableListChanged } from "../lib/variable-diff.js";
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

  const draftAtom = useMemo(() => getDraftAtom(promptId), [promptId]);
  const draft = useAtomValue(draftAtom);

  const [initializing, setInitializing] = useState(true);
  const [saving, setSaving] = useState(false);
  const [variables, setVariables] = useState<PromptVariableInput[]>([]);
  const [parentVariables, setParentVariables] = useState<PromptVariableInput[]>([]);
  // Label of the version we're forking from. Sent as `fromVersion` so the
  // backend records `parentVersionId` (lineage) and inherits the parent's
  // variable set when the user makes no explicit edits to it. Null only
  // for prompts with zero versions (a legacy/edge case).
  const [parentVersionLabel, setParentVersionLabel] = useState<string | null>(null);
  const [debouncedContent] = useDebouncedValue(draft?.current ?? "", SNAPSHOT_DEBOUNCE_MS);

  const monacoRef = useRef<Monaco | null>(null);
  const editorRef = useRef<EditorInstance | null>(null);
  const decorationsRef = useRef<string[]>([]);

  useEffect(() => {
    ensurePlaceholderStyles();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchDetail(promptId)
      .then((d) => {
        if (cancelled) return;
        const latest = d.versions[0];
        const baseContent = latest?.sourcePrompt ?? "";
        const inheritedVariables: PromptVariableInput[] = (latest?.variables ?? []).map(
          (v) => ({
            name: v.name,
            description: v.description,
            defaultValue: v.defaultValue,
            required: v.required,
          }),
        );
        initDraft({ promptId, baseContent });
        setParentVariables(inheritedVariables);
        setVariables(inheritedVariables);
        setParentVersionLabel(latest?.version ?? null);
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

  const referencedNames = useMemo(
    () => parseVariableReferences(draft?.current ?? ""),
    [draft?.current],
  );

  const declaredNames = useMemo(
    () =>
      new Set(
        variables.map((v) => v.name.trim()).filter((n) => n.length > 0),
      ),
    [variables],
  );

  // Repaint placeholder decorations whenever the body or declared set
  // changes. Pure visual feedback — backend integrity check is the source
  // of truth at save time.
  useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor) return;
    decorationsRef.current = paintPlaceholderDecorations(
      monaco,
      editor,
      declaredNames,
      decorationsRef.current,
    );
  }, [draft?.current, declaredNames]);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
  };

  const handleEditorChange = (value: string | undefined) => {
    updateDraftCurrent({ promptId, content: value ?? "" });
  };

  const variablesChanged = useMemo(
    () => hasVariableListChanged(variables, parentVariables),
    [variables, parentVariables],
  );

  const handleSave = async () => {
    if (!draft) return;
    const variablesError = validateVariableList(variables);
    if (variablesError) {
      notifications.show({ color: "red", title: "Variables invalid", message: variablesError });
      return;
    }
    const undeclared = referencedNames.filter((name) => !declaredNames.has(name));
    if (undeclared.length > 0) {
      notifications.show({
        color: "red",
        title: "Undeclared placeholders",
        message: `Add these to Variables: ${undeclared.map((n) => `{{${n}}}`).join(", ")}`,
      });
      return;
    }
    setSaving(true);
    try {
      // Always fork from the latest version so the new version records
      // `parentVersionId` (lineage) and — when the user did not edit the
      // variable list — inherits the parent's variables on the backend
      // side. Variables sent explicitly only when the user touched them.
      const version = await createVersion({
        promptId,
        input: {
          sourcePrompt: draft.current,
          ...(parentVersionLabel ? { fromVersion: parentVersionLabel } : {}),
          ...(variablesChanged
            ? {
                variables: variables.map((v) => ({
                  name: v.name.trim(),
                  description: v.description ?? null,
                  defaultValue: v.defaultValue ?? null,
                  required: v.required ?? false,
                })),
              }
            : {}),
        },
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

  const bodyDirty = draft.current !== draft.baseContent;
  const isDirty = bodyDirty || variablesChanged;

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
              onMount={handleEditorMount}
              theme="vs-dark"
              options={{ minimap: { enabled: false }, wordWrap: "on", fontSize: 14 }}
            />
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Paper withBorder p="md">
            <Tabs defaultValue="variables">
              <Tabs.List grow>
                <Tabs.Tab value="variables">
                  Variables{variables.length > 0 ? ` (${variables.length})` : ""}
                </Tabs.Tab>
                <Tabs.Tab value="drafts">Drafts</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="variables" pt="md">
                <VariablesPanel
                  value={variables}
                  onChange={setVariables}
                  referenced={referencedNames}
                />
              </Tabs.Panel>
              <Tabs.Panel value="drafts" pt="md">
                <DraftHistoryPanel promptId={promptId} />
              </Tabs.Panel>
            </Tabs>
          </Paper>
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
