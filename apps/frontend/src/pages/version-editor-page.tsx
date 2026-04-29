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

// Editor instance & decoration types are not exported by `@monaco-editor/react`,
// so we derive them from the `OnMount` callback signature instead of pulling
// in `monaco-editor` directly (which is a peer dep we don't bundle).
type EditorInstance = Parameters<OnMount>[0];
type DeltaDecoration = Parameters<EditorInstance["deltaDecorations"]>[1][number];
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
import { ApiError } from "../lib/api-client.js";

const SNAPSHOT_DEBOUNCE_MS = 1500;
const PLACEHOLDER_PATTERN = /\{\{\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\}\}/g;

// Monaco decoration class. Defined globally and applied as a CSS rule via
// the monaco theme so the inline `{{var}}` highlight survives editor
// remounts. Color picked to read on the vs-dark theme.
const PLACEHOLDER_STYLE_ID = "plexus-placeholder-style";

const ensurePlaceholderStyles = () => {
  if (typeof document === "undefined") return;
  if (document.getElementById(PLACEHOLDER_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = PLACEHOLDER_STYLE_ID;
  style.textContent = `
    .plexus-placeholder-known {
      background-color: rgba(64, 192, 87, 0.2);
      border-radius: 2px;
      font-weight: 600;
    }
    .plexus-placeholder-unknown {
      background-color: rgba(250, 82, 82, 0.25);
      border-radius: 2px;
      font-weight: 600;
      text-decoration: underline wavy rgba(250, 82, 82, 0.7);
    }
  `;
  document.head.appendChild(style);
};

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
  // changes. Known-but-undeclared references render in red; declared ones in
  // green. Pure visual feedback — backend integrity check is the source of
  // truth at save time.
  useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor) return;
    const model = editor.getModel();
    if (!model) return;
    const text = model.getValue();
    const newDecorations: DeltaDecoration[] = [];
    for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const startPos = model.getPositionAt(start);
      const endPos = model.getPositionAt(end);
      const inner = match[0].slice(2, -2).trim();
      const isKnown = declaredNames.has(inner);
      newDecorations.push({
        range: new monaco.Range(
          startPos.lineNumber,
          startPos.column,
          endPos.lineNumber,
          endPos.column,
        ),
        options: {
          inlineClassName: isKnown
            ? "plexus-placeholder-known"
            : "plexus-placeholder-unknown",
          hoverMessage: {
            value: isKnown
              ? `Declared variable: \`${inner}\``
              : `Undeclared placeholder \`${inner}\` — add it to Variables before saving.`,
          },
        },
      });
    }
    decorationsRef.current = editor.deltaDecorations(
      decorationsRef.current,
      newDecorations,
    );
  }, [draft?.current, declaredNames]);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
  };

  const handleEditorChange = (value: string | undefined) => {
    updateDraftCurrent({ promptId, content: value ?? "" });
  };

  const variablesChanged = useMemo(() => {
    if (variables.length !== parentVariables.length) return true;
    for (let i = 0; i < variables.length; i += 1) {
      const a = variables[i];
      const b = parentVariables[i];
      if (!a || !b) return true;
      if (
        a.name !== b.name ||
        (a.description ?? null) !== (b.description ?? null) ||
        (a.defaultValue ?? null) !== (b.defaultValue ?? null) ||
        (a.required ?? false) !== (b.required ?? false)
      ) {
        return true;
      }
    }
    return false;
  }, [variables, parentVariables]);

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
      // Send `variables` only when the list was actually edited; otherwise
      // omit the field so the backend keeps the parent's set unchanged
      // (CreateVersion's inheritance semantics).
      const version = await createVersion({
        promptId,
        input: {
          sourcePrompt: draft.current,
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
