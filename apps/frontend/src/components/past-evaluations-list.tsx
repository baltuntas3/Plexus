import { useEffect, useState } from "react";
import {
  Badge,
  Card,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useAtomValue, useSetAtom } from "jotai";
import { Link } from "react-router-dom";
import type {
  BenchmarkDto,
  BenchmarkStatus,
  PromptVersionDto,
} from "@plexus/shared-types";
import {
  benchmarksListRefreshAtom,
  fetchBenchmarksForVersionAtom,
} from "../atoms/benchmarks.atoms.js";

// Status palette mirrors the benchmark detail page so a benchmark looks the
// same here and there — colour drift across surfaces makes status meaning
// harder to learn.
const STATUS_COLOR: Record<BenchmarkStatus, string> = {
  draft: "yellow",
  queued: "gray",
  running: "blue",
  completed: "green",
  completed_with_budget_cap: "orange",
  failed: "red",
};

// Compact "n minutes/hours/days ago" — full timestamp on hover would be
// nicer once we need it; for now the relative form keeps the row visually
// uncluttered and matches typical "history" UI conventions.
const formatRelative = (iso: string): string => {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
};

interface PastEvaluationsListProps {
  promptVersionId: string;
  // Used to resolve version ids in `bm.promptVersionIds` to friendly labels
  // (`v3 (rev 2)`) instead of opaque hashes. Versions outside this list
  // (e.g. archived) fall back to a short suffix of their id.
  versions: PromptVersionDto[];
}

export const PastEvaluationsList = ({
  promptVersionId,
  versions,
}: PastEvaluationsListProps) => {
  const fetchList = useSetAtom(fetchBenchmarksForVersionAtom);
  const refreshCounter = useAtomValue(benchmarksListRefreshAtom);
  const [items, setItems] = useState<BenchmarkDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    void fetchList({ promptVersionId, page: 1, pageSize: 25 })
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchList, promptVersionId, refreshCounter]);

  if (error) {
    return (
      <Paper withBorder p="lg">
        <Stack gap={4}>
          <Title order={4}>Past Evaluations</Title>
          <Text size="sm" c="red">
            Could not load past evaluations: {error}
          </Text>
        </Stack>
      </Paper>
    );
  }

  if (items === null) {
    return (
      <Paper withBorder p="lg">
        <Stack gap={4}>
          <Title order={4}>Past Evaluations</Title>
          <Group gap="xs">
            <Loader size="xs" />
            <Text size="sm" c="dimmed">
              Loading past evaluations…
            </Text>
          </Group>
        </Stack>
      </Paper>
    );
  }

  if (items.length === 0) {
    return (
      <Paper withBorder p="lg">
        <Stack gap={4}>
          <Title order={4}>Past Evaluations</Title>
          <Text size="sm" c="dimmed">
            No evaluations have been run for this version yet. Generate one
            above to see it here, including per-judge rubric scores and
            reasoning on the detail page.
          </Text>
        </Stack>
      </Paper>
    );
  }

  const labelById = new Map(versions.map((v) => [v.id, v.version]));

  return (
    <Paper withBorder p="lg">
      <Stack gap="md">
        <div>
          <Title order={4}>Past Evaluations</Title>
          <Text size="xs" c="dimmed">
            {items.length} evaluation{items.length === 1 ? "" : "s"} include
            this version. Click a row for per-row judge votes, rubric scores,
            and reasoning.
          </Text>
        </div>
        <Stack gap="xs">
          {items.map((bm) => {
            const versionLabels = bm.promptVersionIds
              .map((id) => labelById.get(id) ?? id.slice(-6))
              .join(", ");
            const cellsLabel =
              bm.progress.total > 0
                ? `${bm.progress.completed}/${bm.progress.total}`
                : "—";
            return (
              <Card
                key={bm.id}
                withBorder
                p="sm"
                component={Link}
                to={`/benchmarks/${bm.id}`}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <Stack gap={4}>
                  <Group justify="space-between" wrap="nowrap" gap="xs">
                    <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                      <Badge
                        color={STATUS_COLOR[bm.status]}
                        size="sm"
                        variant="filled"
                      >
                        {bm.status.replace(/_/g, " ")}
                      </Badge>
                      <Text size="sm" fw={500} lineClamp={1}>
                        {bm.name}
                      </Text>
                    </Group>
                    <Text size="xs" c="dimmed">
                      {formatRelative(bm.createdAt)}
                    </Text>
                  </Group>
                  <Group gap="md" wrap="wrap">
                    <Text size="xs" c="dimmed">
                      <strong>Versions:</strong> {versionLabels}
                    </Text>
                    <Text size="xs" c="dimmed">
                      <strong>Solvers:</strong> {bm.solverModels.join(", ")}
                    </Text>
                    <Text size="xs" c="dimmed">
                      <strong>Judges:</strong> {bm.judgeModels.join(", ")}
                    </Text>
                    <Text size="xs" c="dimmed">
                      <strong>Reps:</strong> {bm.repetitions} ·{" "}
                      <strong>Cells:</strong> {cellsLabel}
                    </Text>
                  </Group>
                </Stack>
              </Card>
            );
          })}
        </Stack>
      </Stack>
    </Paper>
  );
};
