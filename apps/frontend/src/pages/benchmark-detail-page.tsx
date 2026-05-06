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
  Select,
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
import { useLocation, useNavigate, useParams } from "react-router-dom";
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
  BenchmarkAnalysisDto,
  BenchmarkDetailDto,
  BenchmarkProgressDto,
  BenchmarkResultDto,
  BenchmarkStatus,
  BenchmarkTestCaseDto,
  TestCaseCategory,
} from "@plexus/shared-types";
import {
  fetchBenchmarkAnalysisAtom,
  fetchBenchmarkDetailAtom,
  startBenchmarkAtom,
  updateTestCasesAtom,
} from "../atoms/benchmarks.atoms.js";
import { tokensAtom } from "../atoms/auth.atoms.js";
import { openSSE } from "../lib/sse-client.js";
import { ApiError } from "../lib/api-client.js";
import {
  aggregateBenchmarkResults,
  buildDraftBenchmarkEdits,
  buildResultsByCase,
  buildTestCaseUpdatePayload,
  CATEGORY_OPTIONS,
  createEmptyNewCase,
  type NewCaseDraft,
} from "./benchmark-detail-page.helpers.js";

const STATUS_COLOR: Record<BenchmarkStatus, string> = {
  draft: "yellow",
  queued: "gray",
  running: "blue",
  completed: "green",
  completed_with_budget_cap: "orange",
  failed: "red",
};


export const BenchmarkDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const tokens = useAtomValue(tokensAtom);
  const fetchDetail = useSetAtom(fetchBenchmarkDetailAtom);
  const startBenchmark = useSetAtom(startBenchmarkAtom);
  const updateTestCases = useSetAtom(updateTestCasesAtom);
  const fetchAnalysis = useSetAtom(fetchBenchmarkAnalysisAtom);

  const [benchmark, setBenchmark] = useState<BenchmarkDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  // Local edits while in draft mode.
  const [inputEdits, setInputEdits] = useState<Record<string, string>>({});
  const [expectedOutputs, setExpectedOutputs] = useState<Record<string, string>>({});
  const [categoryEdits, setCategoryEdits] = useState<Record<string, TestCaseCategory | null>>({});
  const [newCases, setNewCases] = useState<NewCaseDraft[]>([]);
  const [analysis, setAnalysis] = useState<BenchmarkAnalysisDto | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const returnTo =
    typeof location.state === "object" &&
    location.state !== null &&
    "returnTo" in location.state &&
    typeof location.state.returnTo === "string"
      ? location.state.returnTo
      : null;

  const applyBenchmark = (bm: BenchmarkDetailDto) => {
    setBenchmark(bm);
    const edits = buildDraftBenchmarkEdits(bm.testCases);
    setInputEdits(edits.inputEdits);
    setExpectedOutputs(edits.expectedOutputs);
    setCategoryEdits(edits.categoryEdits);
    setNewCases([]);
  };

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    fetchDetail(id)
      .then((bm) => {
        if (!cancelled) {
          applyBenchmark(bm);
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
      benchmark.status === "completed_with_budget_cap" ||
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

  const handleLoadAnalysis = async () => {
    if (!id) return;
    setAnalysisLoading(true);
    setAnalysisError(null);
    try {
      const result = await fetchAnalysis(id);
      setAnalysis(result);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to load analysis";
      setAnalysisError(message);
    } finally {
      setAnalysisLoading(false);
    }
  };

  // Auto-load analysis once the benchmark completes.
  useEffect(() => {
    if (
      !id ||
      (benchmark?.status !== "completed" &&
        benchmark?.status !== "completed_with_budget_cap") ||
      analysis ||
      analysisLoading
    ) {
      return;
    }
    void handleLoadAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [benchmark?.status, id]);

  const handleStart = async () => {
    if (!id || !benchmark) return;
    setStarting(true);
    // Clear any analysis loaded from a previous run so the auto-load effect
    // picks up the new completion. Without this, restarting a completed/
    // failed/budget-capped benchmark leaves the old analysis on screen and
    // the gate at `analysis ||` keeps re-fetch suppressed.
    setAnalysis(null);
    setAnalysisError(null);
    try {
      const updatesPayload = buildTestCaseUpdatePayload(
        benchmark,
        { inputEdits, expectedOutputs, categoryEdits },
        newCases,
      );
      await updateTestCases({ benchmarkId: id, ...updatesPayload });
      await startBenchmark(id);
      const bm = await fetchDetail(id);
      applyBenchmark(bm);
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
  const versionLabels = benchmark.versionLabels;
  const comparedVersions = benchmark.promptVersionIds
    .map((id) => versionLabels[id] ?? id.slice(-6))
    .join(" vs ");

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
            Compared versions: {comparedVersions} ·
          </Text>
          <Text size="sm" c="dimmed">
            Judges: {benchmark.judgeModels.join(", ")} · Generator: {benchmark.generatorModel} ·
            Solvers: {benchmark.solverModels.join(", ")} · Repetitions: {benchmark.repetitions}
          </Text>
          {benchmark.costForecast && (
            <Text size="sm" c="dimmed">
              Task type: {benchmark.taskType} · Heuristic run cost estimate: $
              {benchmark.costForecast.estimatedTotalCostUsd.toFixed(4)} for{" "}
              {benchmark.costForecast.estimatedMatrixCells} cells
            </Text>
          )}
        </Stack>
        <Group>
          <Button
            variant="default"
            onClick={() => {
              if (returnTo) {
                navigate(returnTo);
                return;
              }
              navigate(-1);
            }}
          >
            Back
          </Button>
          {benchmark.status === "draft" && (
            <Button onClick={handleStart} loading={starting}>
              Start Benchmark
            </Button>
          )}
          {(
            benchmark.status === "queued" ||
            benchmark.status === "failed" ||
            benchmark.status === "completed_with_budget_cap"
          ) && (
            <Button onClick={handleStart} loading={starting}>
              {benchmark.status === "failed" || benchmark.status === "completed_with_budget_cap"
                ? "Resume"
                : "Start"}
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
            disabled={
              (benchmark.status !== "completed" &&
                benchmark.status !== "completed_with_budget_cap") ||
              benchmark.results.length === 0
            }
          >
            PPD / Golden Quadrant
          </Tabs.Tab>
          <Tabs.Tab
            value="judge-analysis"
            disabled={
              (benchmark.status !== "completed" &&
                benchmark.status !== "completed_with_budget_cap") ||
              benchmark.results.length === 0
            }
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
            categoryEdits={categoryEdits}
            onCategoryChange={(tcId, value) =>
              setCategoryEdits((prev) => ({ ...prev, [tcId]: value }))
            }
            newCases={newCases}
            onNewCaseChange={(localId, field, value) =>
              setNewCases((prev) =>
                prev.map((nc) => nc.localId === localId ? { ...nc, [field]: value } : nc),
              )
            }
            onAddCase={() =>
              setNewCases((prev) => [...prev, createEmptyNewCase()])
            }
            onRemoveNewCase={(localId) =>
              setNewCases((prev) => prev.filter((nc) => nc.localId !== localId))
            }
            results={benchmark.results}
            versionLabels={versionLabels}
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
                versionLabels={versionLabels}
              />
              <ResultsTable
                results={benchmark.results}
                versionLabels={versionLabels}
              />
            </Stack>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="ppd" pt="md">
          {id &&
            (benchmark.status === "completed" ||
              benchmark.status === "completed_with_budget_cap") && (
            <PPDDashboard
              analysis={analysis}
              loading={analysisLoading}
              versionLabels={versionLabels}
            />
          )}
        </Tabs.Panel>

        <Tabs.Panel value="judge-analysis" pt="md">
          <AnalysisPanel
            analysis={analysis}
            loading={analysisLoading}
            error={analysisError}
            versionLabels={versionLabels}
            onLoad={handleLoadAnalysis}
          />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
};

// --- Test Cases Panel ---

interface TestCasesPanelProps {
  testCases: BenchmarkTestCaseDto[];
  editable: boolean;
  inputEdits: Record<string, string>;
  onInputChange: (id: string, value: string) => void;
  expectedOutputs: Record<string, string>;
  onExpectedOutputChange: (id: string, value: string) => void;
  categoryEdits: Record<string, TestCaseCategory | null>;
  onCategoryChange: (id: string, value: TestCaseCategory | null) => void;
  newCases: NewCaseDraft[];
  onNewCaseChange: (
    localId: string,
    field: "input" | "expectedOutput" | "category",
    value: string,
  ) => void;
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
            <Badge size="xs" variant="outline" color="gray">run {r.runIndex + 1}</Badge>
          </Group>
          {r.status === "failed" ? (
            <Badge color="red" size="xs" variant="filled">
              failed
            </Badge>
          ) : (
            <Group gap={4}>
              <Tooltip label="Accuracy (ensemble mean)" withArrow>
                <Badge color={scoreColor(r.judgeAccuracy)} size="xs" variant="filled">
                  Acc {r.judgeAccuracy.toFixed(2)}/5
                </Badge>
              </Tooltip>
              <Tooltip label="Coherence (ensemble mean)" withArrow>
                <Badge color={scoreColor(r.judgeCoherence)} size="xs" variant="filled">
                  Coh {r.judgeCoherence.toFixed(2)}/5
                </Badge>
              </Tooltip>
              <Tooltip label="Instruction following (ensemble mean)" withArrow>
                <Badge color={scoreColor(r.judgeInstruction)} size="xs" variant="filled">
                  Ins {r.judgeInstruction.toFixed(2)}/5
                </Badge>
              </Tooltip>
              <Badge color="gray" size="xs" variant="light">
                {r.finalScore.toFixed(3)}
              </Badge>
            </Group>
          )}
        </Group>
        {r.status === "failed" ? (
          <Text size="sm" c="red">
            Failed: {r.error ?? "Unknown error"}
          </Text>
        ) : (
          <Text size="sm" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
            {r.candidateOutput}
          </Text>
        )}
        {r.status === "completed" && r.error && (
          <Alert color="yellow" variant="light" title="Scored with partial judge coverage">
            {r.error}
          </Alert>
        )}
        {r.judgeVotes.length > 0 && (
          <Stack gap={2}>
            <Text size="xs" c="dimmed" fw={500}>Judge votes</Text>
            {r.judgeVotes.map((v, i) => (
              <Text key={`${v.model}-${i}`} size="xs" c="dimmed" style={{ lineHeight: 1.5 }}>
                <strong>{v.model}</strong>: Acc {v.accuracy}/5 · Coh {v.coherence}/5 · Ins {v.instruction}/5
                {v.reasoning ? ` — ${v.reasoning}` : ""}
              </Text>
            ))}
          </Stack>
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
  categoryEdits,
  onCategoryChange,
  newCases,
  onNewCaseChange,
  onAddCase,
  onRemoveNewCase,
  results,
  versionLabels,
}: TestCasesPanelProps) => {
  const resultsByCase = buildResultsByCase(results);

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
                  <Group gap={4}>
                    {tc.category && (
                      <Badge variant="outline" size="xs" color="grape">
                        {tc.category.replace("_", " ")}
                      </Badge>
                    )}
                    {tc.source === "manual" && (
                      <Badge variant="outline" size="xs" color="gray">manual</Badge>
                    )}
                    {caseResults.length > 0 && (
                      <Badge variant="light" size="sm" color="blue">
                        {caseResults.length} result{caseResults.length > 1 ? "s" : ""}
                      </Badge>
                    )}
                  </Group>
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

                  {editable && (
                    <Select
                      label="Category"
                      size="xs"
                      data={CATEGORY_OPTIONS}
                      value={categoryEdits[tc.id] ?? ""}
                      onChange={(value) => onCategoryChange(tc.id, (value as TestCaseCategory | "") || null)}
                    />
                  )}

                  {caseResults.length > 0 && (
                    <Stack gap="xs">
                      <Text size="xs" c="dimmed" fw={500}>Runs</Text>
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
                <Select
                  label="Category"
                  size="xs"
                  data={CATEGORY_OPTIONS}
                  value={nc.category}
                  onChange={(value) => onNewCaseChange(nc.localId, "category", value ?? "")}
                />
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

const ResultsChart = ({
  results,
  versionLabels,
}: {
  results: BenchmarkResultDto[];
  versionLabels: Record<string, string>;
}) => {
  const data = aggregateBenchmarkResults(results, versionLabels);
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
  const rows = aggregateBenchmarkResults(results, versionLabels);
  return (
    <Card withBorder>
      <Stack gap="xs">
        <Group gap="xs">
          <Text fw={600}>Aggregated results</Text>
          <Text size="xs" c="dimmed">
            Mean completed-run score and observed total cost per version × solver
          </Text>
        </Group>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Version</Table.Th>
              <Table.Th>Solver</Table.Th>
              <Table.Th>Avg Score</Table.Th>
              <Table.Th>Accuracy</Table.Th>
              <Table.Th>Observed Cost</Table.Th>
              <Table.Th>Runs</Table.Th>
              <Table.Th>Failures</Table.Th>
              <Table.Th>Ops Issues</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => {
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
                      {row.accuracyAllRuns.toFixed(2)}/5
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">${row.costUsd.toFixed(5)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">{row.totalRuns}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c={row.failedRuns > 0 ? "red" : "dimmed"}>
                      {row.failedRuns} ({(row.failureRate * 100).toFixed(0)}%)
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text
                      size="xs"
                      c={row.operationalIssueRate > 0 ? "orange" : "dimmed"}
                    >
                      {(row.operationalIssueRate * 100).toFixed(0)}%
                    </Text>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
        <Text size="xs" c="dimmed">
          Quality averages use completed runs only. `Observed Cost` includes spend from all runs, including failed ones when usage was known. `Failures` counts hard failed rows; `Ops Issues` also includes partial judge degradation and excludes budget truncation.
        </Text>
      </Stack>
    </Card>
  );
};

// --- Analysis Panel ---

interface AnalysisPanelProps {
  analysis: BenchmarkAnalysisDto | null;
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

const AnalysisPanel = ({
  analysis,
  loading,
  error,
  versionLabels,
  onLoad,
}: AnalysisPanelProps) => {
  if (!analysis && !loading && !error) {
    return (
      <Stack align="center" py="xl" gap="sm">
        <Text c="dimmed" size="sm">
          Run AI analysis to get per-candidate stats with confidence intervals and a recommendation.
        </Text>
        <Button onClick={onLoad}>Run Analysis</Button>
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

  const candidateLabel = (candidateKey: string): string => {
    const candidate = analysis.candidates.find((entry) => entry.candidateKey === candidateKey);
    if (!candidate) return candidateKey;
    const versionLabel =
      versionLabels[candidate.promptVersionId] ?? candidate.promptVersionId.slice(-6);
    return `${versionLabel} · ${candidate.solverModel}`;
  };

  return (
    <Stack gap="md">
      {analysis.recommendedKey && (
        <Card withBorder style={{ borderColor: "var(--mantine-color-teal-6)" }}>
          <Group gap="sm">
            <ThemeIcon color="teal" size="lg" radius="xl">
              <Text size="sm" fw={700}>✓</Text>
            </ThemeIcon>
            <Stack gap={2}>
              <Text fw={600} size="sm">Recommended setup</Text>
              <Text size="sm">{candidateLabel(analysis.recommendedKey)}</Text>
              {analysis.recommendationDecision.mode === "paired_cost_tie_break" && (
                <Group gap="xs">
                  <Badge color="blue" variant="light" size="xs">
                    paired tie-break
                  </Badge>
                  {analysis.recommendationDecision.pairedDiffCiLow !== null &&
                    analysis.recommendationDecision.pairedDiffCiHigh !== null && (
                    <Text size="xs" c="dimmed">
                      paired diff CI [{analysis.recommendationDecision.pairedDiffCiLow.toFixed(3)}, {analysis.recommendationDecision.pairedDiffCiHigh.toFixed(3)}]
                    </Text>
                  )}
                </Group>
              )}
              {analysis.recommendedReasoning && (
                <Text size="xs" c="dimmed">{analysis.recommendedReasoning}</Text>
              )}
            </Stack>
          </Group>
        </Card>
      )}

      <Card withBorder>
        <Stack gap="xs">
          <Text fw={600}>Judge agreement</Text>
          <Text size="xs" c="dimmed">
            Pairwise rubric closeness across judge votes on the same completed rows. The "Agreement" column is <code>1 − MAE/4</code> on the 1-5 rubric, NOT a chance-corrected reliability statistic (Cohen κ / Krippendorff α). Two judges that happen to cluster around the middle of the scale will look more agreeable than they really are; use this column to spot drift, not to certify reliability.
          </Text>
          {analysis.judgeAgreement.length === 0 ? (
            <Text size="sm" c="dimmed">Not enough multi-judge data.</Text>
          ) : (
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Judge pair</Table.Th>
                  <Table.Th>Shared rows</Table.Th>
                  <Table.Th>
                    <Tooltip
                      label="1 - MAE/4 on the 1-5 rubric. NOT chance-corrected; mid-scale clustering inflates this. Use for drift, not for IRR."
                      withArrow
                      multiline
                      w={320}
                    >
                      <Text size="sm" component="span" style={{ borderBottom: "1px dotted" }}>
                        Rubric match (MAE-based)
                      </Text>
                    </Tooltip>
                  </Table.Th>
                  <Table.Th>Exact match</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {analysis.judgeAgreement.map((row) => (
                  <Table.Tr key={`${row.judgeModelA}-${row.judgeModelB}`}>
                    <Table.Td>
                      <Text size="sm">{row.judgeModelA} vs {row.judgeModelB}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">{row.sharedVotes}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{(row.agreementScore * 100).toFixed(1)}%</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">{(row.exactAgreementRate * 100).toFixed(1)}%</Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Stack>
      </Card>

      <Card withBorder>
        <Stack gap="xs">
          <Text fw={600}>Category breakdown</Text>
          <Text size="xs" c="dimmed">
            Per-category quality and reliability across candidates. Categories come from generated labels or manual cases.
          </Text>
          <Alert color="blue" variant="light">
            Failed rows keep observed solver latency and any known solver/judge token spend, so cost and failure columns remain failure-aware.
          </Alert>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Category</Table.Th>
                <Table.Th>Version</Table.Th>
                <Table.Th>Solver</Table.Th>
                <Table.Th>Mean score</Table.Th>
                <Table.Th>Accuracy</Table.Th>
                <Table.Th>Coherence</Table.Th>
                <Table.Th>Instruction</Table.Th>
                <Table.Th>Solver latency</Table.Th>
                <Table.Th>Cost/test</Table.Th>
                <Table.Th>Runs</Table.Th>
                <Table.Th>Failures</Table.Th>
                <Table.Th>Ops Issues</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {analysis.categoryBreakdown.map((s) => {
                const vLabel =
                  versionLabels[s.promptVersionId] ?? s.promptVersionId.slice(-6);
                const isRecommended = s.candidateKey === analysis.recommendedKey;
                return (
                  <Table.Tr
                    key={`${s.candidateKey}-${s.category}`}
                    style={
                      isRecommended
                        ? { background: "var(--mantine-color-teal-light)" }
                        : undefined
                    }
                  >
                    <Table.Td>
                      <Badge variant="outline" size="sm" color="grape">
                        {s.category.replace("_", " ")}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs">
                        <Badge variant="light" color="blue" size="sm">{vLabel}</Badge>
                        {isRecommended && <Badge color="teal" size="xs">recommended</Badge>}
                      </Group>
                    </Table.Td>
                    <Table.Td><Text size="sm">{s.solverModel}</Text></Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={500}>{s.meanFinalScore.toFixed(3)}</Text>
                    </Table.Td>
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
                      <Text size="sm" c="dimmed">{Math.round(s.meanSolverLatencyMs)} ms</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">${s.meanCostUsd.toFixed(4)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">{s.completedCount}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {s.failedCount} ({(s.failureRate * 100).toFixed(0)}%)
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text
                        size="xs"
                        c={s.operationalIssueRate > 0 ? "orange" : "dimmed"}
                      >
                        {(s.operationalIssueRate * 100).toFixed(0)}%
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Stack>
      </Card>

      <Card withBorder>
        <Stack gap="md">
          <Group justify="space-between">
            <Stack gap={2}>
              <Text fw={600}>Ensemble judge feedback</Text>
              <Text size="xs" c="dimmed">
                Real, attributed reasoning from each judge — top- and bottom-rated rows per
                judge, plus the row of maximum disagreement.
              </Text>
            </Stack>
            <Button size="xs" variant="subtle" onClick={onLoad} loading={loading}>
              Refresh
            </Button>
          </Group>
          {analysis.ensembleJudgeReport.perCandidate.length === 0 ? (
            <Text size="sm" c="dimmed">
              No judge votes available yet. Run a benchmark to populate this section.
            </Text>
          ) : (
            <Stack gap="md">
              {analysis.ensembleJudgeReport.perCandidate.map((entry) => (
                <Card
                  key={entry.candidateKey}
                  withBorder
                  style={
                    entry.candidateKey === analysis.recommendedKey
                      ? { borderColor: "var(--mantine-color-teal-6)" }
                      : undefined
                  }
                >
                  <Stack gap="sm">
                    <Group gap="xs">
                      <Text fw={600} size="sm">
                        {candidateLabel(entry.candidateKey)}
                      </Text>
                      {entry.candidateKey === analysis.recommendedKey && (
                        <Badge color="teal" size="xs">recommended</Badge>
                      )}
                    </Group>
                    {entry.judges.map((judge) => (
                      <Stack key={judge.model} gap={4}>
                        <Group gap="xs">
                          <Badge size="xs" variant="light" color="blue">
                            {judge.model}
                          </Badge>
                          <Text size="xs" c="dimmed">
                            {judge.voteCount} vote(s) · A {judge.meanAccuracy.toFixed(2)} ·
                            C {judge.meanCoherence.toFixed(2)} ·
                            I {judge.meanInstruction.toFixed(2)}
                          </Text>
                        </Group>
                        {judge.topRated && (
                          <Group gap="xs" align="flex-start" wrap="nowrap">
                            <Badge size="xs" color="teal" variant="light">top</Badge>
                            <Text size="xs" c="dimmed">
                              {judge.topRated.testCaseId.slice(-6)}#{judge.topRated.runIndex} ·
                              A{judge.topRated.rubric.accuracy} C{judge.topRated.rubric.coherence}
                              I{judge.topRated.rubric.instruction} ·
                              "{judge.topRated.reasoning}"
                            </Text>
                          </Group>
                        )}
                        {judge.bottomRated && (
                          <Group gap="xs" align="flex-start" wrap="nowrap">
                            <Badge size="xs" color="orange" variant="light">bottom</Badge>
                            <Text size="xs" c="dimmed">
                              {judge.bottomRated.testCaseId.slice(-6)}#{judge.bottomRated.runIndex} ·
                              A{judge.bottomRated.rubric.accuracy} C{judge.bottomRated.rubric.coherence}
                              I{judge.bottomRated.rubric.instruction} ·
                              "{judge.bottomRated.reasoning}"
                            </Text>
                          </Group>
                        )}
                      </Stack>
                    ))}
                    {entry.maxDisagreement && (
                      <Stack gap={4} pt="xs" style={{ borderTop: "1px solid var(--mantine-color-gray-3)" }}>
                        <Group gap="xs">
                          <Badge size="xs" color="grape" variant="light">
                            biggest split
                          </Badge>
                          <Text size="xs" c="dimmed">
                            {entry.maxDisagreement.testCaseId.slice(-6)}#{entry.maxDisagreement.runIndex} ·
                            spread {entry.maxDisagreement.spread.toFixed(2)}
                          </Text>
                        </Group>
                        {entry.maxDisagreement.perJudge.map((vote) => (
                          <Text key={vote.model} size="xs" c="dimmed">
                            <strong>{vote.model}</strong> · A{vote.accuracy} C{vote.coherence}
                            I{vote.instruction} · "{vote.reasoning}"
                          </Text>
                        ))}
                      </Stack>
                    )}
                  </Stack>
                </Card>
              ))}
            </Stack>
          )}
        </Stack>
      </Card>
    </Stack>
  );
};
