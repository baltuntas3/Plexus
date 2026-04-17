import { useEffect, useState } from "react";
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Progress,
  RingProgress,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  ThemeIcon,
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
  BenchmarkJudgeAnalysisDto,
  BenchmarkProgressDto,
  BenchmarkResultDto,
  BenchmarkStatus,
  BenchmarkTestCaseDto,
} from "@plexus/shared-types";
import {
  fetchBenchmarkDetailAtom,
  fetchBenchmarkJudgeAnalysisAtom,
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
  const fetchJudgeAnalysis = useSetAtom(fetchBenchmarkJudgeAnalysisAtom);

  const [benchmark, setBenchmark] = useState<BenchmarkDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  // Local edits while in draft mode.
  const [inputEdits, setInputEdits] = useState<Record<string, string>>({});
  const [expectedOutputs, setExpectedOutputs] = useState<Record<string, string>>({});
  const [newCases, setNewCases] = useState<Array<{ localId: string; input: string; expectedOutput: string }>>([]);
  const [judgeAnalysis, setJudgeAnalysis] = useState<BenchmarkJudgeAnalysisDto | null>(null);
  const [judgeAnalysisLoading, setJudgeAnalysisLoading] = useState(false);
  const [judgeAnalysisError, setJudgeAnalysisError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    fetchDetail(id)
      .then((bm) => {
        if (!cancelled) {
          setBenchmark(bm);
          // Seed local edits with any previously saved values.
          const inputs: Record<string, string> = {};
          const outputs: Record<string, string> = {};
          for (const tc of bm.testCases) {
            inputs[tc.id] = tc.input;
            if (tc.expectedOutput) outputs[tc.id] = tc.expectedOutput;
          }
          setInputEdits(inputs);
          setExpectedOutputs(outputs);
          setNewCases([]);
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

  const handleLoadJudgeAnalysis = async () => {
    if (!id) return;
    setJudgeAnalysisLoading(true);
    setJudgeAnalysisError(null);
    try {
      const result = await fetchJudgeAnalysis(id);
      setJudgeAnalysis(result);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to load analysis";
      setJudgeAnalysisError(message);
    } finally {
      setJudgeAnalysisLoading(false);
    }
  };

  // Auto-load judge analysis once the benchmark completes.
  useEffect(() => {
    if (!id || benchmark?.status !== "completed" || judgeAnalysis || judgeAnalysisLoading) return;
    void handleLoadJudgeAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [benchmark?.status, id]);

  const handleStart = async () => {
    if (!id || !benchmark) return;
    setStarting(true);
    try {
      // Flush all local edits before starting.
      const updates = benchmark.testCases.map((tc) => ({
        id: tc.id,
        input: inputEdits[tc.id] !== tc.input ? inputEdits[tc.id] : undefined,
        expectedOutput: expectedOutputs[tc.id] ?? null,
      }));
      const additions = newCases.map((nc) => ({
        input: nc.input,
        expectedOutput: nc.expectedOutput || null,
      }));
      await updateTestCases({ benchmarkId: id, updates, additions });
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
          <Tabs.Tab
            value="judge-analysis"
            disabled={benchmark.status !== "completed" || benchmark.results.length === 0}
          >
            AI Analysis
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="test-cases" pt="md">
          <TestCasesPanel
            testCases={benchmark.testCases}
            editable={benchmark.status === "draft"}
            inputEdits={inputEdits}
            onInputChange={(tcId, value) =>
              setInputEdits((prev) => ({ ...prev, [tcId]: value }))
            }
            expectedOutputs={expectedOutputs}
            onExpectedOutputChange={(tcId, value) =>
              setExpectedOutputs((prev) => ({ ...prev, [tcId]: value }))
            }
            newCases={newCases}
            onNewCaseChange={(localId, field, value) =>
              setNewCases((prev) =>
                prev.map((nc) => nc.localId === localId ? { ...nc, [field]: value } : nc),
              )
            }
            onAddCase={() =>
              setNewCases((prev) => [
                ...prev,
                { localId: crypto.randomUUID(), input: "", expectedOutput: "" },
              ])
            }
            onRemoveNewCase={(localId) =>
              setNewCases((prev) => prev.filter((nc) => nc.localId !== localId))
            }
            results={benchmark.results}
            versionLabels={buildVersionLabels(benchmark.promptVersionIds)}
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

        <Tabs.Panel value="judge-analysis" pt="md">
          <JudgeAnalysisPanel
            analysis={judgeAnalysis}
            loading={judgeAnalysisLoading}
            error={judgeAnalysisError}
            versionLabels={buildVersionLabels(benchmark.promptVersionIds)}
            onLoad={handleLoadJudgeAnalysis}
          />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
};

// --- Test Cases Panel ---

interface NewCase {
  localId: string;
  input: string;
  expectedOutput: string;
}

interface TestCasesPanelProps {
  testCases: BenchmarkTestCaseDto[];
  editable: boolean;
  inputEdits: Record<string, string>;
  onInputChange: (id: string, value: string) => void;
  expectedOutputs: Record<string, string>;
  onExpectedOutputChange: (id: string, value: string) => void;
  newCases: NewCase[];
  onNewCaseChange: (localId: string, field: "input" | "expectedOutput", value: string) => void;
  onAddCase: () => void;
  onRemoveNewCase: (localId: string) => void;
  results: BenchmarkResultDto[];
  versionLabels: Record<string, string>;
}

const SCORE_COLOR: Record<number, string> = { 5: "teal", 4: "green", 3: "yellow", 2: "orange", 1: "red" };
const scoreColor = (v: number) => SCORE_COLOR[Math.round(v)] ?? "gray";

const CandidateCard = ({
  r,
  versionLabels,
}: {
  r: BenchmarkResultDto;
  versionLabels: Record<string, string>;
}) => {
  const vLabel = versionLabels[r.promptVersionId] ?? r.promptVersionId.slice(-6);
  return (
    <Card withBorder p="sm">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs">
            <Badge variant="light" color="blue" size="sm">{vLabel}</Badge>
            <Text size="xs" c="dimmed">{r.solverModel}</Text>
          </Group>
          <Group gap={4}>
            <Tooltip label="Accuracy" withArrow>
              <Badge color={scoreColor(r.judgeAccuracy)} size="xs" variant="filled">
                Acc {r.judgeAccuracy}/5
              </Badge>
            </Tooltip>
            <Tooltip label="Coherence" withArrow>
              <Badge color={scoreColor(r.judgeCoherence)} size="xs" variant="filled">
                Coh {r.judgeCoherence}/5
              </Badge>
            </Tooltip>
            <Tooltip label="Instruction following" withArrow>
              <Badge color={scoreColor(r.judgeInstruction)} size="xs" variant="filled">
                Ins {r.judgeInstruction}/5
              </Badge>
            </Tooltip>
            <Badge color="gray" size="xs" variant="light">
              {r.finalScore.toFixed(3)}
            </Badge>
          </Group>
        </Group>
        <Text size="sm" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
          {r.candidateOutput}
        </Text>
        {r.judgeReasoning && (
          <div>
            <Text size="xs" c="dimmed" fw={500} mb={2}>Judge reasoning</Text>
            <Text size="xs" c="dimmed" style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
              {r.judgeReasoning}
            </Text>
          </div>
        )}
      </Stack>
    </Card>
  );
};

const TestCasesPanel = ({
  testCases,
  editable,
  inputEdits,
  onInputChange,
  expectedOutputs,
  onExpectedOutputChange,
  newCases,
  onNewCaseChange,
  onAddCase,
  onRemoveNewCase,
  results,
  versionLabels,
}: TestCasesPanelProps) => {
  const resultsByCase = new Map<string, BenchmarkResultDto[]>();
  for (const r of results) {
    if (r.status !== "completed") continue;
    const list = resultsByCase.get(r.testCaseId) ?? [];
    list.push(r);
    resultsByCase.set(r.testCaseId, list);
  }

  const totalCount = testCases.length + newCases.length;

  if (totalCount === 0 && !editable) {
    return <Text c="dimmed" size="sm">No test cases.</Text>;
  }

  return (
    <Stack gap="sm">
      <Accordion variant="separated" multiple>
        {testCases.map((tc, i) => {
          const caseResults = resultsByCase.get(tc.id) ?? [];
          const currentInput = inputEdits[tc.id] ?? tc.input;
          return (
            <Accordion.Item key={tc.id} value={tc.id}>
              <Accordion.Control>
                <Group justify="space-between" wrap="nowrap" pr="sm">
                  <Text size="sm" fw={500} lineClamp={2} style={{ flex: 1 }}>
                    {i + 1}. {currentInput}
                  </Text>
                  {caseResults.length > 0 && (
                    <Badge variant="light" size="sm" color="blue">
                      {caseResults.length} result{caseResults.length > 1 ? "s" : ""}
                    </Badge>
                  )}
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap="sm">
                  <div>
                    <Text size="xs" c="dimmed" fw={500} mb={2}>Input</Text>
                    {editable ? (
                      <Textarea
                        size="xs"
                        autosize
                        minRows={2}
                        maxRows={6}
                        value={currentInput}
                        onChange={(e) => onInputChange(tc.id, e.currentTarget.value)}
                      />
                    ) : (
                      <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{tc.input}</Text>
                    )}
                  </div>

                  <div>
                    <Text size="xs" c="dimmed" fw={500} mb={2}>Expected output</Text>
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
                  </div>

                  {caseResults.length > 0 && (
                    <Stack gap="xs">
                      <Text size="xs" c="dimmed" fw={500}>Candidate outputs</Text>
                      {caseResults.map((r) => (
                        <CandidateCard key={r.id} r={r} versionLabels={versionLabels} />
                      ))}
                    </Stack>
                  )}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          );
        })}

        {newCases.map((nc, i) => (
          <Accordion.Item key={nc.localId} value={nc.localId}>
            <Accordion.Control>
              <Group justify="space-between" wrap="nowrap" pr="sm">
                <Text size="sm" fw={500} lineClamp={1} c={nc.input ? undefined : "dimmed"} style={{ flex: 1 }}>
                  {testCases.length + i + 1}. {nc.input || "New test case..."}
                </Text>
                <Badge variant="light" size="sm" color="teal">new</Badge>
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="sm">
                <div>
                  <Text size="xs" c="dimmed" fw={500} mb={2}>Input</Text>
                  <Textarea
                    size="xs"
                    placeholder="Enter the user message for this test case"
                    autosize
                    minRows={2}
                    maxRows={6}
                    value={nc.input}
                    onChange={(e) => onNewCaseChange(nc.localId, "input", e.currentTarget.value)}
                  />
                </div>
                <div>
                  <Text size="xs" c="dimmed" fw={500} mb={2}>Expected output</Text>
                  <Textarea
                    size="xs"
                    placeholder="Optional — leave blank to skip reference scoring"
                    autosize
                    minRows={1}
                    maxRows={4}
                    value={nc.expectedOutput}
                    onChange={(e) => onNewCaseChange(nc.localId, "expectedOutput", e.currentTarget.value)}
                  />
                </div>
                <Group justify="flex-end">
                  <Button
                    size="xs"
                    variant="subtle"
                    color="red"
                    onClick={() => onRemoveNewCase(nc.localId)}
                  >
                    Remove
                  </Button>
                </Group>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>

      {editable && (
        <Button variant="light" size="sm" onClick={onAddCase}>
          + Add test case
        </Button>
      )}
    </Stack>
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

// --- Judge Analysis Panel ---

interface JudgeAnalysisPanelProps {
  analysis: BenchmarkJudgeAnalysisDto | null;
  loading: boolean;
  error: string | null;
  versionLabels: Record<string, string>;
  onLoad: () => void;
}

const ringScoreColor = (value: number, max: number): string => {
  const ratio = value / max;
  if (ratio >= 0.8) return "teal";
  if (ratio >= 0.6) return "yellow";
  return "red";
};

const JudgeAnalysisPanel = ({
  analysis,
  loading,
  error,
  versionLabels,
  onLoad,
}: JudgeAnalysisPanelProps) => {
  if (!analysis && !loading && !error) {
    return (
      <Stack align="center" py="xl" gap="sm">
        <Text c="dimmed" size="sm">
          Run AI analysis to get category-level insights and a version recommendation.
        </Text>
        <Button onClick={onLoad}>Run AI Analysis</Button>
      </Stack>
    );
  }

  if (loading) {
    return (
      <Center py="xl">
        <Stack align="center" gap="xs">
          <Loader />
          <Text size="sm" c="dimmed">Analyzing results...</Text>
        </Stack>
      </Center>
    );
  }

  if (error) {
    return (
      <Stack gap="sm">
        <Alert color="red" title="Analysis failed">{error}</Alert>
        <Button variant="light" onClick={onLoad}>Retry</Button>
      </Stack>
    );
  }

  if (!analysis) return null;

  return (
    <Stack gap="md">
      {analysis.recommendedKey && (
        <Card withBorder style={{ borderColor: "var(--mantine-color-teal-6)" }}>
          <Group gap="sm">
            <ThemeIcon color="teal" size="lg" radius="xl">
              <Text size="sm" fw={700}>✓</Text>
            </ThemeIcon>
            <Stack gap={2}>
              <Text fw={600} size="sm">Recommended version</Text>
              <Text size="sm">{analysis.recommendedKey}</Text>
              {analysis.recommendedReasoning && (
                <Text size="xs" c="dimmed">{analysis.recommendedReasoning}</Text>
              )}
            </Stack>
          </Group>
        </Card>
      )}

      <Card withBorder>
        <Stack gap="xs">
          <Text fw={600}>Category breakdown</Text>
          <Text size="xs" c="dimmed">
            Accuracy, Coherence, Instruction scored 1–5 · Consistency = score stability across test cases
          </Text>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Version</Table.Th>
                <Table.Th>Solver</Table.Th>
                <Table.Th>Accuracy</Table.Th>
                <Table.Th>Coherence</Table.Th>
                <Table.Th>Instruction</Table.Th>
                <Table.Th>Consistency</Table.Th>
                <Table.Th>Latency</Table.Th>
                <Table.Th>Cost/test</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {analysis.categoryStats.map((s) => {
                const [versionId, solverModel] = s.candidateKey.split("::");
                const vLabel = versionId
                  ? (versionLabels[versionId] ?? versionId.slice(-6))
                  : s.candidateKey;
                const isRecommended = s.candidateKey === analysis.recommendedKey;
                return (
                  <Table.Tr
                    key={s.candidateKey}
                    style={
                      isRecommended
                        ? { background: "var(--mantine-color-teal-light)" }
                        : undefined
                    }
                  >
                    <Table.Td>
                      <Group gap="xs">
                        <Badge variant="light" color="blue" size="sm">{vLabel}</Badge>
                        {isRecommended && <Badge color="teal" size="xs">recommended</Badge>}
                      </Group>
                    </Table.Td>
                    <Table.Td><Text size="sm">{solverModel ?? "—"}</Text></Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        <RingProgress
                          size={28}
                          thickness={3}
                          roundCaps
                          sections={[{ value: (s.meanAccuracy / 5) * 100, color: ringScoreColor(s.meanAccuracy, 5) }]}
                        />
                        <Text size="sm">{s.meanAccuracy.toFixed(2)}</Text>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        <RingProgress
                          size={28}
                          thickness={3}
                          roundCaps
                          sections={[{ value: (s.meanCoherence / 5) * 100, color: ringScoreColor(s.meanCoherence, 5) }]}
                        />
                        <Text size="sm">{s.meanCoherence.toFixed(2)}</Text>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        <RingProgress
                          size={28}
                          thickness={3}
                          roundCaps
                          sections={[{ value: (s.meanInstruction / 5) * 100, color: ringScoreColor(s.meanInstruction, 5) }]}
                        />
                        <Text size="sm">{s.meanInstruction.toFixed(2)}</Text>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        <RingProgress
                          size={28}
                          thickness={3}
                          roundCaps
                          sections={[{ value: s.consistencyScore * 100, color: ringScoreColor(s.consistencyScore, 1) }]}
                        />
                        <Text size="sm">{(s.consistencyScore * 100).toFixed(1)}%</Text>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">{Math.round(s.meanLatencyMs)} ms</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">${s.meanCostUsd.toFixed(4)}</Text>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Stack>
      </Card>

      <Card withBorder>
        <Stack gap="xs">
          <Group justify="space-between">
            <Text fw={600}>Commentary</Text>
            <Button size="xs" variant="subtle" onClick={onLoad} loading={loading}>
              Re-run
            </Button>
          </Group>
          <Text size="sm" style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
            {analysis.commentary}
          </Text>
        </Stack>
      </Card>
    </Stack>
  );
};
