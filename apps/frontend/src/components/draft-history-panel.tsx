import {
  Accordion,
  Badge,
  Box,
  Button,
  Group,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useAtomValue, useSetAtom } from "jotai";
import { useMemo } from "react";
import {
  draftAtomFamily,
  HISTORY_LIMIT,
  revertDraftAtom,
  type DraftSnapshot,
} from "../atoms/draft-history.atoms.js";
import { DiffView } from "./diff-view.js";

interface DraftHistoryPanelProps {
  promptId: string;
}

interface SnapshotEntry {
  snapshot: DraftSnapshot;
  previousContent: string;
  index: number;
}

export const DraftHistoryPanel = ({ promptId }: DraftHistoryPanelProps) => {
  const draftAtom = useMemo(() => draftAtomFamily(promptId), [promptId]);
  const draft = useAtomValue(draftAtom);
  const revert = useSetAtom(revertDraftAtom);

  if (!draft || draft.history.length === 0) {
    return (
      <Stack gap="xs">
        <Title order={5}>History</Title>
        <Text c="dimmed" size="sm">
          No snapshots yet. Edits are auto-saved as snapshots.
        </Text>
      </Stack>
    );
  }

  const entries: SnapshotEntry[] = draft.history.map((snapshot, idx) => ({
    snapshot,
    previousContent: idx === 0 ? draft.baseContent : (draft.history[idx - 1]?.content ?? ""),
    index: idx,
  }));

  const reversed = [...entries].reverse();

  const handleRevert = (snapshotId: string) => {
    revert({ promptId, snapshotId });
  };

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Title order={5}>History</Title>
        <Badge variant="light">
          {draft.history.length} / {HISTORY_LIMIT}
        </Badge>
      </Group>
      <Accordion variant="separated" multiple>
        {reversed.map(({ snapshot, previousContent, index }) => (
          <Accordion.Item key={snapshot.id} value={snapshot.id}>
            <Accordion.Control>
              <Group justify="space-between" wrap="nowrap">
                <Box>
                  <Text size="sm" fw={500}>
                    Snapshot #{index + 1}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {new Date(snapshot.timestamp).toLocaleString()}
                  </Text>
                </Box>
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="xs">
                <DiffView oldText={previousContent} newText={snapshot.content} />
                <Group justify="flex-end">
                  <Button size="xs" variant="light" onClick={() => handleRevert(snapshot.id)}>
                    Revert to this
                  </Button>
                </Group>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </Stack>
  );
};
