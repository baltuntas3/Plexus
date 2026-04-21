import {
  Alert,
  Badge,
  Card,
  Group,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import { IconStar, IconTrendingUp } from "@tabler/icons-react";
import {
  CartesianGrid,
  Label,
  ReferenceDot,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BenchmarkAnalysisDto, CandidateStatsDto } from "@plexus/shared-types";

interface Props {
  analysis: BenchmarkAnalysisDto | null;
  loading?: boolean;
  versionLabels: Record<string, string>;
}

const vLabel = (id: string, versionLabels: Record<string, string>): string =>
  versionLabels[id] ?? id.slice(-6);

const candidateLabel = (c: CandidateStatsDto, versionLabels: Record<string, string>): string =>
  `${vLabel(c.promptVersionId, versionLabels)} · ${c.solverModel}`;

const RELIABILITY_ISSUE_RATE_LIMIT = 0.1;

const reliableCandidates = (
  candidates: readonly CandidateStatsDto[],
): CandidateStatsDto[] =>
  candidates.filter(
    (c) => c.completedCount > 0 && c.operationalIssueRate <= RELIABILITY_ISSUE_RATE_LIMIT,
  );

export const PPDDashboard = ({ analysis, loading = false, versionLabels }: Props) => {
  if (loading) {
    return <Text c="dimmed" size="sm">Loading analysis...</Text>;
  }
  if (!analysis || analysis.candidates.length === 0) {
    return <Text c="dimmed" size="sm">No completed results to analyse yet.</Text>;
  }

  const completedCandidates = analysis.candidates.filter((c) => c.completedCount > 0);
  if (completedCandidates.length === 0) {
    return <Text c="dimmed" size="sm">All cells failed — no data for analysis.</Text>;
  }
  const visibleCandidates = reliableCandidates(completedCandidates);

  return (
    <Stack>
      <VersionComparisonPanel analysis={analysis} versionLabels={versionLabels} />
      <RecommendationBanner analysis={analysis} versionLabels={versionLabels} />
      {visibleCandidates.length === 0 ? (
        <Alert color="yellow" variant="light" title="No reliable setups">
          All completed candidates exceeded the operational issue threshold, so PPD and
          frontier views are hidden until a reliable run is available.
        </Alert>
      ) : (
        <>
          <GoldenQuadrantChart
            analysis={analysis}
            candidates={visibleCandidates}
            versionLabels={versionLabels}
          />
          <PPDTable
            analysis={analysis}
            candidates={visibleCandidates}
            versionLabels={versionLabels}
          />
        </>
      )}
    </Stack>
  );
};

// --- Version Comparison Panel ---
// Only rendered when 2+ versions are benchmarked. Shows per-version aggregates
// and deltas vs the first version so the user can quickly see which version improved.

interface VersionSummary {
  versionId: string;
  versionLabel: string;
  bestScore: number;
  bestScoreSetup: string;
  lowestCostUsd: number;
  bestPPD: number | null;
}

const VersionComparisonPanel = ({
  analysis,
  versionLabels,
}: {
  analysis: BenchmarkAnalysisDto;
  versionLabels: Record<string, string>;
}) => {
  const versionIds = [...new Set(analysis.candidates.map((c) => c.promptVersionId))];
  if (versionIds.length < 2) return null;

  const summaries: VersionSummary[] = versionIds.flatMap((vId) => {
    const completed = analysis.candidates.filter(
      (c) => c.promptVersionId === vId && c.completedCount > 0,
    );
    const vCandidates = reliableCandidates(completed);
    if (vCandidates.length === 0) return [];

    const bestScore = vCandidates.reduce((a, b) =>
      a.meanFinalScore > b.meanFinalScore ? a : b,
    );
    const cheapest = vCandidates.reduce((a, b) =>
      a.totalCostUsd < b.totalCostUsd ? a : b,
    );
    const ppdRows = analysis.ppd.filter((row) =>
      vCandidates.some((c) => c.candidateKey === row.candidateKey),
    );
    const bestPPDRow =
      ppdRows.length > 0 ? ppdRows.reduce((a, b) => (a.ppd > b.ppd ? a : b)) : null;

    return [
      {
        versionId: vId,
        versionLabel: vLabel(vId, versionLabels),
        bestScore: bestScore.meanFinalScore,
        bestScoreSetup: bestScore.solverModel,
        lowestCostUsd: cheapest.totalCostUsd,
        bestPPD: bestPPDRow?.ppd ?? null,
      },
    ];
  });

  if (summaries.length < 2) return null;

  summaries.sort((left, right) =>
    left.versionLabel.localeCompare(right.versionLabel, undefined, { numeric: true }),
  );

  const baseline = summaries[0]!;

  const scoreDelta = (s: VersionSummary): number | null => {
    if (s === baseline || baseline.bestScore === 0) return null;
    return ((s.bestScore - baseline.bestScore) / baseline.bestScore) * 100;
  };

  const costDelta = (s: VersionSummary): number | null => {
    if (s === baseline || baseline.lowestCostUsd === 0) return null;
    return ((s.lowestCostUsd - baseline.lowestCostUsd) / baseline.lowestCostUsd) * 100;
  };

  return (
    <Card withBorder>
      <Stack gap="xs">
        <Group gap="xs">
          <Text fw={600}>Version Comparison</Text>
          <Text size="xs" c="dimmed">
            — best score and lowest cost across solver setups for each version
          </Text>
        </Group>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Version</Table.Th>
              <Table.Th>Best Score</Table.Th>
              <Table.Th>vs {baseline.versionLabel}</Table.Th>
              <Table.Th>Best Setup</Table.Th>
              <Table.Th>Lowest Cost</Table.Th>
              <Table.Th>vs {baseline.versionLabel}</Table.Th>
              <Table.Th>
                <Tooltip
                  label="Best Performance-per-Dollar across this version's setups. Higher = same quality for less money."
                  multiline
                  maw={280}
                  withArrow
                >
                  <Text size="sm" style={{ cursor: "help", textDecoration: "underline dotted" }}>
                    Best PPD
                  </Text>
                </Tooltip>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {summaries.map((s) => {
              const sd = scoreDelta(s);
              const cd = costDelta(s);
              return (
                <Table.Tr key={s.versionId}>
                  <Table.Td>
                    <Badge variant="light" color="blue">{s.versionLabel}</Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" fw={500}>{s.bestScore.toFixed(4)}</Text>
                  </Table.Td>
                  <Table.Td>
                    {sd !== null ? (
                      <Badge color={sd >= 0 ? "green" : "red"} variant="light" size="sm">
                        {sd >= 0 ? "+" : ""}{sd.toFixed(1)}%
                      </Badge>
                    ) : (
                      <Text size="xs" c="dimmed">baseline</Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">{s.bestScoreSetup}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">${s.lowestCostUsd.toFixed(5)}</Text>
                  </Table.Td>
                  <Table.Td>
                    {cd !== null ? (
                      <Badge
                        color={cd <= 0 ? "green" : "red"}
                        variant="light"
                        size="sm"
                      >
                        {cd >= 0 ? "+" : ""}{cd.toFixed(1)}%
                      </Badge>
                    ) : (
                      <Text size="xs" c="dimmed">baseline</Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {s.bestPPD !== null ? (
                      <Badge color="blue" variant="light">
                        {s.bestPPD === Infinity ? "∞×" : `${s.bestPPD.toFixed(2)}×`}
                      </Badge>
                    ) : (
                      <Text size="xs" c="dimmed">—</Text>
                    )}
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

// --- Recommendation Banner ---

const RecommendationBanner = ({
  analysis,
  versionLabels,
}: {
  analysis: BenchmarkAnalysisDto;
  versionLabels: Record<string, string>;
}) => {
  if (!analysis.recommendedKey) return null;
  const candidate = analysis.candidates.find(
    (c) => c.candidateKey === analysis.recommendedKey,
  );
  if (!candidate) return null;
  const ppdRow = analysis.ppd.find((r) => r.candidateKey === analysis.recommendedKey);
  const baselineCandidate = analysis.candidates.find(
    (c) => c.candidateKey === analysis.baselineKey,
  );

  const ppdValue =
    ppdRow?.ppd === Infinity ? "∞×" : ppdRow ? `${ppdRow.ppd.toFixed(2)}×` : null;

  return (
    <Card withBorder style={{ borderColor: "var(--mantine-color-green-4)" }}>
      <Group>
        <ThemeIcon color="green" variant="light" size="lg">
          <IconStar size={18} />
        </ThemeIcon>
        <Stack gap={4}>
          <Group gap="xs">
            <Text fw={600}>Recommended setup</Text>
            {ppdValue && (
              <Tooltip
                label={`${ppdValue} PPD — this setup delivers ${ppdValue} more performance per dollar than the baseline${baselineCandidate ? ` (${candidateLabel(baselineCandidate, versionLabels)})` : ""}.`}
                multiline
                maw={320}
                withArrow
              >
                <Badge
                  color={ppdRow?.isMoreEfficient ? "green" : "orange"}
                  variant="light"
                  style={{ cursor: "help" }}
                >
                  {ppdValue} PPD
                </Badge>
              </Tooltip>
            )}
            {analysis.recommendationDecision.mode === "paired_cost_tie_break" && (
              <Tooltip
                label={`Top composite and selected setup were statistically inseparable under paired bootstrap, so the cheaper setup was chosen.${analysis.recommendationDecision.pairedDiffCiLow !== null && analysis.recommendationDecision.pairedDiffCiHigh !== null ? ` Paired score-difference CI: [${analysis.recommendationDecision.pairedDiffCiLow.toFixed(3)}, ${analysis.recommendationDecision.pairedDiffCiHigh.toFixed(3)}].` : ""}`}
                multiline
                maw={360}
                withArrow
              >
                <Badge color="blue" variant="light" style={{ cursor: "help" }}>
                  paired tie-break
                </Badge>
              </Tooltip>
            )}
          </Group>
          <Text size="sm" c="dimmed">
            {candidateLabel(candidate, versionLabels)} · score{" "}
            {candidate.meanFinalScore.toFixed(4)} · ${candidate.totalCostUsd.toFixed(5)}
          </Text>
          {baselineCandidate && (
            <Text size="xs" c="dimmed">
              PPD baseline: {candidateLabel(baselineCandidate, versionLabels)} (highest-cost
              qualified setup)
            </Text>
          )}
        </Stack>
      </Group>
    </Card>
  );
};

// --- Golden Quadrant Chart ---

interface ScatterPoint {
  costUsd: number;
  score: number;
  label: string;
  key: string;
  onFrontier: boolean;
  isBaseline: boolean;
  isRecommended: boolean;
}

const GoldenQuadrantChart = ({
  analysis,
  candidates,
  versionLabels,
}: {
  analysis: BenchmarkAnalysisDto;
  candidates: CandidateStatsDto[];
  versionLabels: Record<string, string>;
}) => {
  const points: ScatterPoint[] = candidates.map((c) => ({
    costUsd: c.totalCostUsd,
    score: c.meanFinalScore,
    label: candidateLabel(c, versionLabels),
    key: c.candidateKey,
    onFrontier: analysis.paretoFrontierKeys.includes(c.candidateKey),
    isBaseline: c.candidateKey === analysis.baselineKey,
    isRecommended: c.candidateKey === analysis.recommendedKey,
  }));

  const frontier = points.filter((p) => p.onFrontier).sort((a, b) => a.costUsd - b.costUsd);
  const rest = points.filter((p) => !p.onFrontier);

  return (
    <Card withBorder>
      <Stack gap="xs">
        <Group gap="xs">
          <Text fw={600}>Cost vs Quality (Golden Quadrant)</Text>
          <Text size="xs" c="dimmed">— top-left corner is ideal: high score, low cost</Text>
        </Group>
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="costUsd" name="Total Cost (USD)" type="number">
                <Label value="Total cost (USD)" offset={-10} position="insideBottom" />
              </XAxis>
              <YAxis dataKey="score" name="Avg Score" domain={[0, 1]}>
                <Label value="Avg final score" angle={-90} position="insideLeft" />
              </YAxis>
              <RechartsTooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={({ payload }) => {
                  const p = payload?.[0]?.payload as ScatterPoint | undefined;
                  if (!p) return null;
                  return (
                    <div
                      style={{
                        background: "var(--mantine-color-body)",
                        border: "1px solid var(--mantine-color-gray-3)",
                        padding: "8px 12px",
                        borderRadius: 4,
                        fontSize: 12,
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{p.label}</div>
                      <div>Score: {p.score.toFixed(4)}</div>
                      <div>Cost: ${p.costUsd.toFixed(6)}</div>
                      {p.onFrontier && (
                        <div style={{ color: "var(--mantine-color-blue-6)" }}>
                          Pareto frontier — not dominated by any other setup
                        </div>
                      )}
                      {p.isBaseline && (
                        <div style={{ color: "var(--mantine-color-gray-6)" }}>
                          PPD baseline
                        </div>
                      )}
                      {p.isRecommended && (
                        <div style={{ color: "#f08c00" }}>Recommended</div>
                      )}
                    </div>
                  );
                }}
              />
              <Scatter name="Others" data={rest} fill="#adb5bd" opacity={0.7} />
              <Scatter name="Pareto frontier" data={frontier} fill="#4dabf7" opacity={0.9} />
              {(() => {
                const rec = points.find((p) => p.isRecommended);
                if (!rec) return null;
                return (
                  <ReferenceDot
                    x={rec.costUsd}
                    y={rec.score}
                    r={10}
                    fill="none"
                    stroke="#ffd43b"
                    strokeWidth={3}
                  />
                );
              })()}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <Group gap="lg">
          <Group gap={4}>
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#4dabf7" }} />
            <Text size="xs">Pareto frontier (not dominated)</Text>
          </Group>
          <Group gap={4}>
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#adb5bd" }} />
            <Text size="xs">Dominated</Text>
          </Group>
          <Group gap={4}>
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                border: "3px solid #ffd43b",
                background: "none",
              }}
            />
            <Text size="xs">Recommended</Text>
          </Group>
        </Group>
      </Stack>
    </Card>
  );
};

// --- PPD Rankings Table ---

const PPDTable = ({
  analysis,
  candidates,
  versionLabels,
}: {
  analysis: BenchmarkAnalysisDto;
  candidates: CandidateStatsDto[];
  versionLabels: Record<string, string>;
}) => {
  if (analysis.ppd.length === 0) return null;

  const baselineCandidate = analysis.candidates.find(
    (c) => c.candidateKey === analysis.baselineKey,
  );

  const rows = candidates
    .map((c) => {
      const ppdRow = analysis.ppd.find((r) => r.candidateKey === c.candidateKey);
      return { candidate: c, ppdRow };
    })
    .filter((r) => r.ppdRow !== undefined)
    .sort((a, b) => (b.ppdRow?.ppd ?? 0) - (a.ppdRow?.ppd ?? 0));

  return (
    <Card withBorder>
      <Stack gap="xs">
        <Group gap="xs">
          <IconTrendingUp size={16} />
          <Text fw={600}>PPD Rankings</Text>
          <Tooltip
            label={`PPD = (candidate score / candidate cost) ÷ (baseline score / baseline cost). A PPD of 2× means this setup delivers twice the performance per dollar compared to the baseline.${baselineCandidate ? ` Baseline: ${candidateLabel(baselineCandidate, versionLabels)}` : ""}`}
            multiline
            maw={340}
            withArrow
          >
            <Text
              size="xs"
              c="dimmed"
              style={{ cursor: "help", textDecoration: "underline dotted" }}
            >
              What is PPD?
            </Text>
          </Tooltip>
        </Group>
        {baselineCandidate && (
          <Text size="xs" c="dimmed">
            Baseline: {candidateLabel(baselineCandidate, versionLabels)} — the
            highest-cost setup that clears 80% of the best observed score. All PPD values
            are relative to it.
          </Text>
        )}
        <Text size="xs" c="dimmed">
          Cost metrics include observed spend from failed rows when token usage was available, so flaky setups do not look artificially cheap.
        </Text>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Version</Table.Th>
              <Table.Th>Solver</Table.Th>
              <Table.Th>Avg Score</Table.Th>
              <Table.Th>Total Cost</Table.Th>
              <Table.Th>
                <Tooltip label="Performance-per-Dollar vs baseline. >1× = more efficient." withArrow>
                  <span style={{ cursor: "help", textDecoration: "underline dotted" }}>PPD</span>
                </Tooltip>
              </Table.Th>
              <Table.Th>Frontier</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map(({ candidate, ppdRow }) => {
              const isRecommended = candidate.candidateKey === analysis.recommendedKey;
              const isBaseline = candidate.candidateKey === analysis.baselineKey;
              return (
                <Table.Tr
                  key={candidate.candidateKey}
                  style={
                    isRecommended
                      ? { background: "var(--mantine-color-green-0)" }
                      : undefined
                  }
                >
                  <Table.Td>
                    <Badge variant="light" color="blue" size="sm">
                      {vLabel(candidate.promptVersionId, versionLabels)}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      <Text size="sm">{candidate.solverModel}</Text>
                      {isRecommended && (
                        <Tooltip label="Recommended setup from the composite ranking and reliability gate">
                          <Badge color="green" variant="light" size="xs">
                            recommended
                          </Badge>
                        </Tooltip>
                      )}
                      {isBaseline && (
                        <Badge color="gray" variant="light" size="xs">
                          baseline
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>{candidate.meanFinalScore.toFixed(4)}</Table.Td>
                  <Table.Td>${candidate.totalCostUsd.toFixed(6)}</Table.Td>
                  <Table.Td>
                    {ppdRow?.ppd === Infinity ? (
                      <Badge color="teal" variant="light">
                        ∞× — zero cost
                      </Badge>
                    ) : (
                      <Tooltip
                        label={
                          ppdRow?.isMoreEfficient
                            ? `${ppdRow.ppd.toFixed(2)}× more performance per dollar than baseline`
                            : `${ppdRow?.ppd.toFixed(2)}× — less efficient than baseline`
                        }
                        withArrow
                      >
                        <Badge
                          color={ppdRow?.isMoreEfficient ? "green" : "red"}
                          variant="light"
                          style={{ cursor: "help" }}
                        >
                          {ppdRow?.ppd.toFixed(3)}×
                        </Badge>
                      </Tooltip>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {analysis.paretoFrontierKeys.includes(candidate.candidateKey) ? (
                      <Badge color="blue" variant="dot" size="xs">
                        yes
                      </Badge>
                    ) : (
                      <Text size="xs" c="dimmed">
                        —
                      </Text>
                    )}
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
