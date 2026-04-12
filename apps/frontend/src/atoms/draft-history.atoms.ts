import { atom } from "jotai";
import { atomFamily, atomWithStorage } from "jotai/utils";

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

export const draftAtomFamily = atomFamily((promptId: string) =>
  atomWithStorage<PromptDraft | null>(`plexus.draft:${promptId}`, null),
);

export const initDraftAtom = atom(
  null,
  (get, set, params: { promptId: string; baseContent: string }) => {
    const draftAtom = draftAtomFamily(params.promptId);
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
    const draftAtom = draftAtomFamily(params.promptId);
    const draft = get(draftAtom);
    if (!draft) return;
    set(draftAtom, { ...draft, current: params.content });
  },
);

export const snapshotDraftAtom = atom(null, (get, set, promptId: string) => {
  const draftAtom = draftAtomFamily(promptId);
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
    const draftAtom = draftAtomFamily(params.promptId);
    const draft = get(draftAtom);
    if (!draft) return;
    const snapshot = draft.history.find((s) => s.id === params.snapshotId);
    if (!snapshot) return;
    set(draftAtom, { ...draft, current: snapshot.content });
  },
);

export const clearDraftAtom = atom(null, (_get, set, promptId: string) => {
  const draftAtom = draftAtomFamily(promptId);
  set(draftAtom, null);
  draftAtomFamily.remove(promptId);
});
