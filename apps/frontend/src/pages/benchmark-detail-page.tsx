import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Progress,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  Title,
  Tooltip,
} from "@mantine/core";
import { PPDDashboard } from "../components/ppd-dashboard.js";
import { notifications } from "@mantine/notifications";
import { useAtomValue, useSetAtom } from "jotai";
import { useNavigate, useParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  BenchmarkDetailDto,
  BenchmarkProgressDto,
  BenchmarkResultDto,
  BenchmarkStatus,
  BenchmarkTestCaseDto,
} from "@plexus/shared-types";
import {
  fetchBenchmarkDetailAtom,
  startBenchmarkAtom,
  updateTestCasesAtom,
} from "../atoms/benchmarks.atoms.js";
import { tokensAtom } from "../atoms/auth.atoms.js";
import { openSSE } from "../lib/sse-client.js";
import { ApiError } from "../lib/api-client.js";

const buildVersionLabels = (ids: string[]): Record<string, string> =>
  Object.fromEntries(ids.map((id, i) => [id, `v${i + 1}`]));

const STATUS_COLOR: Record<BenchmarkStatus, string> = {
  draft: "yellow",
  queued: "gray",
  running: "blue",
  completed: "green",
  failed: "red",
};

export const BenchmarkDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const tokens = useAtomValue(tokensAtom);
  const fetchDetail = useSetAtom(fetchBenchmarkDetailAtom);
  const startBenchmark = useSetAtom(startBenchmarkAtom);
  const updateTestCases = useSetAtom(updateTestCasesAtom);

  const [benchmark, setBenchmark] = useState<BenchmarkDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  // Local edits to expected outputs while in draft mode.
  const [expectedOutputs, setExpectedOutputs] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    fetchDetail(id)
      .then((bm) => {
        if (!cancelled) {
          setBenchmark(bm);
          // Seed local state with any previously saved expected outputs.
          const initial: Record<string, string> = {};
          for (const tc of bm.testCases) {
            if (tc.expectedOutput) initial[tc.id] = tc.expectedOutput;
          }
          setExpectedOutputs(initial);
        }
      })
      .catch((err) => {
        const message = err instanceof ApiError ? err.message : "Failed to load benchmark";
        notifications.show({ color: "red", title: "Error", message });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, fetchDetail]);

  useEffect(() => {
    if (!id || !tokens || !benchmark) return;
    if (
      benchmark.status === "completed" ||
      benchmark.status === "failed" ||
      benchmark.status === "draft"
    )
      return;

    const controller = openSSE(`/benchmarks/${id}/stream`, {
      token: tokens.accessToken,
      onMessage: (msg) => {
        if (msg.event === "progress") {
          try {
            const payload = JSON.parse(msg.data) as {
              progress: BenchmarkProgressDto;
              status: BenchmarkStatus;
            };
            setBenchmark((prev) =>
              prev ? { ...prev, status: payload.status, progress: payload.progress } : prev,
            );
          } catch {
            // ignore malformed event
          }
        } else if (msg.event === "snapshot") {
          try {
            const payload = JSON.parse(msg.data) as BenchmarkDetailDto;
            setBenchmark(payload);
          } catch {
            // ignore
          }
        } else if (msg.event === "done") {
          fetchDetail(id).then((bm) => setBenchmark(bm)).catch(() => undefined);
        }
      },
      onError: () => undefined,
    });

    return () => controller.abort();
  }, [id, tokens, benchmark, fetchDetail]);

  const handleStart = async () => {
    if (!id || !benchmark) return;
    setStarting(true);
    try {
      // Save any annotated expected outputs before starting.
      const updates = benchmark.testCases.map((tc) => ({
        id: tc.id,
        expectedOutput: expectedOutputs[tc.id] ?? null,
      }));
      await updateTestCases({ benchmarkId: id, updates });
      await startBenchmark(id);
      const bm = await fetchDetail(id);
      setBenchmark(bm);
      notifications.show({ color: "green", title: "Started", message: "Benchmark queued" });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to start";
      notifications.show({ color: "red", title: "Error", message });
    } finally {
      setStarting(false);
    }
  };

  if (loading || !benchmark) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  const pct =
    benchmark.progress.total === 0
      ? 0
      : (benchmark.progress.completed / benchmark.progress.total) * 100;

  return (
    <Stack>
      <Group justify="space-between">
        <Stack gap={4}>
          <Group>
            <Title order={2}>{benchmark.name}</Title>
            <Badge color={STATUS_COLOR[benchmark.status]} variant="light">
              {benchmark.status}
            </Badge>
          </Group>
          <Text size="sm" c="dimmed">
            Judge: {benchmark.judgeModel} · Generator: {benchmark.generatorModel} ·
            Solvers: {benchmark.solverModels.join(", ")}
          </Text>
        </Stack>
        <Group>
          <Button variant="default" onClick={() => navigate("/benchmarks")}>
            Back
          </Button>
          {benchmark.status === "draft" && (
            <Button onClick={handleStart} loading={starting}>
              Start Benchmark
            </Button>
          )}
          {(benchmark.status === "queued" || benchmark.status === "failed") && (
            <Button onClick={handleStart} loading={starting}>
              {benchmark.status === "failed" ? "Resume" : "Start"}
            </Button>
          )}
        </Group>
      </Group>

      {benchmark.status !== "draft" && (
        <Card withBorder>
          <Stack gap="xs">
            <Group justify="space-between">
              <Text fw={600}>Progress</Text>
              <Text size="sm" c="dimmed">
                {benchmark.progress.completed} / {benchmark.progress.total}
              </Text>
            </Group>
            <Progress
              value={pct}
              size="lg"
              striped={benchmark.status === "running"}
              animated={benchmark.status === "running"}
            />
            {benchmark.error && (
              <Text size="sm" c="red">
                {benchmark.error}
              </Text>
            )}
          </Stack>
        </Card>
      )}

      <Tabs defaultValue={benchmark.status === "draft" ? "test-cases" : "results"}>
        <Tabs.List>
          <Tabs.Tab value="test-cases">
            Test Cases ({benchmark.testCases.length})
          </Tabs.Tab>
          <Tabs.Tab value="results" disabled={benchmark.status === "draft"}>
            Results
          </Tabs.Tab>
          <Tabs.Tab
            value="ppd"
            disabled={benchmark.status !== "completed" || benchmark.results.length === 0}
          >
            PPD / Golden Quadrant
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="test-cases" pt="md">
          <TestCasesPanel
            testCases={benchmark.testCases}
            editable={benchmark.status === "draft"}
            expectedOutputs={expectedOutputs}
            onExpectedOutputChange={(id, value) =>
              setExpectedOutputs((prev) => ({ ...prev, [id]: value }))
            }
          />
        </Tabs.Panel>

        <Tabs.Panel value="results" pt="md">
          {benchmark.results.length === 0 ? (
            <Text c="dimmed" size="sm">
              No results yet.
            </Text>
          ) : (
            <Stack>
              <ResultsChart
                results={benchmark.results}
                versionLabels={buildVersionLabels(benchmark.promptVersionIds)}
              />
              <ResultsTable
                results={benchmark.results}
                versionLabels={buildVersionLabels(benchmark.promptVersionIds)}
              />
            </Stack>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="ppd" pt="md">
          {id && benchmark.status === "completed" && (
            <PPDDashboard
              benchmarkId={id}
              versionLabels={buildVersionLabels(benchmark.promptVersionIds)}
            />
          )}
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
};

// --- Test Cases Panel ---

interface TestCasesPanelProps {
  testCases: BenchmarkTestCaseDto[];
  editable: boolean;
  expectedOutputs: Record<string, string>;
  onExpectedOutputChange: (id: string, value: string) => void;
}

const TestCasesPanel = ({
  testCases,
  editable,
  expectedOutputs,
  onExpectedOutputChange,
}: TestCasesPanelProps) => {
  if (testCases.length === 0) {
    return <Text c="dimmed" size="sm">No test cases.</Text>;
  }
  return (
    <Card withBorder>
      <Stack gap="xs">
        {editable && (
          <Text size="sm" c="dimmed">
            Optionally fill in expected outputs. The judge will use them as a reference
            when scoring model responses.
          </Text>
        )}
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ width: "40%" }}>Input</Table.Th>
              <Table.Th>Expected Output</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {testCases.map((tc, i) => (
              <Table.Tr key={tc.id}>
                <Table.Td>
                  <Tooltip label={tc.input} multiline maw={400} withArrow>
                    <Text size="sm" lineClamp={2}>
                      {i + 1}. {tc.input}
                    </Text>
                  </Tooltip>
                </Table.Td>
                <Table.Td>
                  {editable ? (
                    <Textarea
                      size="xs"
                      placeholder="Optional — leave blank to skip reference scoring"
                      autosize
                      minRows={1}
                      maxRows={4}
                      value={expectedOutputs[tc.id] ?? ""}
                      onChange={(e) => onExpectedOutputChange(tc.id, e.currentTarget.value)}
                    />
                  ) : (
                    <Text size="sm" c={tc.expectedOutput ? undefined : "dimmed"}>
                      {tc.expectedOutput ?? "—"}
                    </Text>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Stack>
    </Card>
  );
};

// --- Results ---

interface AggregateRow {
  key: string;
  label: string;
  versionId: string;
  versionLabel: string;
  solverModel: string;
  finalScore: number;
  costUsd: number;
  count: number;
}

const aggregate = (
  results: BenchmarkResultDto[],
  versionLabels: Record<string, string>,
): AggregateRow[] => {
  const map = new Map<string, AggregateRow>();
  for (const r of results) {
    if (r.status !== "completed") continue;
    const key = `${r.promptVersionId}::${r.solverModel}`;
    const vLabel = versionLabels[r.promptVersionId] ?? r.promptVersionId.slice(-6);
    const existing = map.get(key);
    if (existing) {
      existing.finalScore += r.finalScore;
      existing.costUsd += r.totalCostUsd;
      existing.count += 1;
    } else {
      map.set(key, {
        key,
        label: `${vLabel} · ${r.solverModel}`,
        versionId: r.promptVersionId,
        versionLabel: vLabel,
        solverModel: r.solverModel,
        finalScore: r.finalScore,
        costUsd: r.totalCostUsd,
        count: 1,
      });
    }
  }
  for (const row of map.values()) {
    row.finalScore = row.count === 0 ? 0 : row.finalScore / row.count;
  }
  return [...map.values()].sort((a, b) => b.finalScore - a.finalScore);
};

const ResultsChart = ({
  results,
  versionLabels,
}: {
  results: BenchmarkResultDto[];
  versionLabels: Record<string, string>;
}) => {
  const data = aggregate(results, versionLabels);
  if (data.length === 0) return null;
  return (
    <Card withBorder>
      <Stack gap="xs">
        <Text fw={600}>Average final score</Text>
        <Text size="xs" c="dimmed">Grouped by version · solver — higher is better</Text>
        <div style={{ width: "100%", height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={data} margin={{ bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" interval={0} />
              <YAxis domain={[0, 1]} tickFormatter={(v: number) => v.toFixed(2)} />
              <RechartsTooltip
                formatter={(value: number) => [value.toFixed(4), "Avg score"]}
              />
              <Bar dataKey="finalScore" fill="#4dabf7" name="Avg final score" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Stack>
    </Card>
  );
};

const ResultsTable = ({
  results,
  versionLabels,
}: {
  results: BenchmarkResultDto[];
  versionLabels: Record<string, string>;
}) => {
  const rows = aggregate(results, versionLabels);
  return (
    <Card withBorder>
      <Stack gap="xs">
        <Group gap="xs">
          <Text fw={600}>Aggregated results</Text>
          <Text size="xs" c="dimmed">Mean score and total cost per version × solver</Text>
        </Group>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Version</Table.Th>
              <Table.Th>Solver</Table.Th>
              <Table.Th>Avg Score</Table.Th>
              <Table.Th>Accuracy</Table.Th>
              <Table.Th>Total Cost</Table.Th>
              <Table.Th>Runs</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => {
              // Compute per-row accuracy from raw results for this group
              const rawForRow = results.filter(
                (r) =>
                  r.status === "completed" &&
                  r.promptVersionId === row.versionId &&
                  r.solverModel === row.solverModel,
              );
              const avgAccuracy =
                rawForRow.length === 0
                  ? null
                  : rawForRow.reduce((s, r) => s + r.judgeAccuracy, 0) / rawForRow.length;

              return (
                <Table.Tr key={row.key}>
                  <Table.Td>
                    <Badge variant="light" color="blue" size="sm">{row.versionLabel}</Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{row.solverModel}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" fw={500}>{row.finalScore.toFixed(4)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {avgAccuracy !== null ? `${avgAccuracy.toFixed(2)}/5` : "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">${row.costUsd.toFixed(5)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">{row.count}</Text>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Stack>
    </Card>
  );
};
