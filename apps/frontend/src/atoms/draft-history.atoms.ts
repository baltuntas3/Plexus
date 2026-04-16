import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { WritableAtom } from "jotai";

export interface DraftSnapshot {
  id: string;
  content: string;
  timestamp: number;
}

export interface PromptDraft {
  baseContent: string;
  current: string;
  history: DraftSnapshot[];
}

export const HISTORY_LIMIT = 20;

// Manual atom map — replaces the deprecated atomFamily from jotai/utils.
// Each promptId gets its own persisted atom created on first access.
type DraftAtom = WritableAtom<PromptDraft | null, [PromptDraft | null], void>;
const draftAtoms = new Map<string, DraftAtom>();

export const getDraftAtom = (promptId: string): DraftAtom => {
  const existing = draftAtoms.get(promptId);
  if (existing) return existing;
  const a = atomWithStorage<PromptDraft | null>(`plexus.draft:${promptId}`, null);
  draftAtoms.set(promptId, a);
  return a;
};

export const initDraftAtom = atom(
  null,
  (get, set, params: { promptId: string; baseContent: string }) => {
    const draftAtom = getDraftAtom(params.promptId);
    const existing = get(draftAtom);
    if (existing) return;
    set(draftAtom, {
      baseContent: params.baseContent,
      current: params.baseContent,
      history: [],
    });
  },
);

export const updateDraftCurrentAtom = atom(
  null,
  (get, set, params: { promptId: string; content: string }) => {
    const draftAtom = getDraftAtom(params.promptId);
    const draft = get(draftAtom);
    if (!draft) return;
    set(draftAtom, { ...draft, current: params.content });
  },
);

export const snapshotDraftAtom = atom(null, (get, set, promptId: string) => {
  const draftAtom = getDraftAtom(promptId);
  const draft = get(draftAtom);
  if (!draft) return;
  const last = draft.history[draft.history.length - 1];
  const previous = last ? last.content : draft.baseContent;
  if (draft.current === previous) return;
  const snapshot: DraftSnapshot = {
    id: crypto.randomUUID(),
    content: draft.current,
    timestamp: Date.now(),
  };
  const history = [...draft.history, snapshot].slice(-HISTORY_LIMIT);
  set(draftAtom, { ...draft, history });
});

export const revertDraftAtom = atom(
  null,
  (get, set, params: { promptId: string; snapshotId: string }) => {
    const draftAtom = getDraftAtom(params.promptId);
    const draft = get(draftAtom);
    if (!draft) return;
    const snapshot = draft.history.find((s) => s.id === params.snapshotId);
    if (!snapshot) return;
    set(draftAtom, { ...draft, current: snapshot.content });
  },
);

export const clearDraftAtom = atom(null, (_get, set, promptId: string) => {
  const draftAtom = getDraftAtom(promptId);
  set(draftAtom, null);
  draftAtoms.delete(promptId);
});
