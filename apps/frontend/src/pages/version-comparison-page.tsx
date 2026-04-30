import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Center,
  Grid,
  Group,
  Loader,
  Paper,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { DiffEditor } from "@monaco-editor/react";
import { useSetAtom } from "jotai";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type {
  PromptVariableDto,
  VersionComparisonDto,
  VersionStatus,
} from "@plexus/shared-types";
import { compareVersionsAtom } from "../atoms/prompts.atoms.js";
import { ApiError } from "../lib/api-client.js";

const statusColor: Record<VersionStatus, string> = {
  draft: "gray",
  development: "blue",
  staging: "yellow",
  production: "green",
};

// Side-by-side comparison view. Body and Graph diffs render via Monaco
// DiffEditor (the graph is treated as plain mermaid text — structural
// graph diff is a follow-up). Variables tab consumes the server-
// computed `variablesDiff`. Metrics tab is a property-by-property
// table built from `base` / `target` directly.
export const VersionComparisonPage = () => {
  const { id } = useParams<{ id: string }>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const compare = useSetAtom(compareVersionsAtom);

  const baseVersion = search.get("base");
  const targetVersion = search.get("target");

  const [comparison, setComparison] = useState<VersionComparisonDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id || !baseVersion || !targetVersion) return;
    let cancelled = false;
    setLoading(true);
    compare({ promptId: id, baseVersion, targetVersion })
      .then((res) => {
        if (!cancelled) setComparison(res);
      })
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? err.message : "Failed to compare";
        notifications.show({ color: "red", title: "Error", message });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, baseVersion, targetVersion, compare]);

  if (!id || !baseVersion || !targetVersion) {
    return (
      <Text c="red">
        Missing comparison parameters. Expected /prompts/:id/compare?base=&target=
      </Text>
    );
  }
  if (loading) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }
  if (!comparison) {
    return <Text c="dimmed">No comparison data</Text>;
  }

  const { base, target, variablesDiff } = comparison;
  const baseLabel = base.name?.trim() || base.version;
  const targetLabel = target.name?.trim() || target.version;

  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Title order={2}>Compare versions</Title>
          <Group gap="xs" mt={4}>
            <Badge color={statusColor[base.status]}>{baseLabel}</Badge>
            <Text size="sm" c="dimmed">
              vs
            </Text>
            <Badge color={statusColor[target.status]}>{targetLabel}</Badge>
          </Group>
        </div>
        <Button variant="subtle" onClick={() => navigate(`/prompts/${id}`)}>
          Back
        </Button>
      </Group>

      <Tabs defaultValue="body">
        <Tabs.List>
          <Tabs.Tab value="body">Body</Tabs.Tab>
          <Tabs.Tab value="graph">Graph</Tabs.Tab>
          <Tabs.Tab value="variables">
            Variables
            {variablesDiff.added.length
            + variablesDiff.removed.length
            + variablesDiff.changed.length >
              0 && (
              <Badge ml={6} size="xs" color="violet" variant="light">
                {variablesDiff.added.length
                  + variablesDiff.removed.length
                  + variablesDiff.changed.length}
              </Badge>
            )}
          </Tabs.Tab>
          <Tabs.Tab value="metrics">Metrics</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="body" pt="md">
          <Paper withBorder p={0} style={{ overflow: "hidden" }}>
            <DiffEditor
              height="65vh"
              original={base.sourcePrompt}
              modified={target.sourcePrompt}
              language="markdown"
              theme="vs-dark"
              options={{
                readOnly: true,
                minimap: { enabled: false },
                renderSideBySide: true,
                wordWrap: "on",
              }}
            />
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="graph" pt="md">
          {!base.braidGraph && !target.braidGraph ? (
            <Center py="xl">
              <Text c="dimmed">Neither version has a BRAID graph</Text>
            </Center>
          ) : (
            <Paper withBorder p={0} style={{ overflow: "hidden" }}>
              <DiffEditor
                height="65vh"
                original={base.braidGraph ?? ""}
                modified={target.braidGraph ?? ""}
                language="plaintext"
                theme="vs-dark"
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  renderSideBySide: true,
                  wordWrap: "on",
                }}
              />
            </Paper>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="variables" pt="md">
          <VariablesDiffPanel diff={variablesDiff} />
        </Tabs.Panel>

        <Tabs.Panel value="metrics" pt="md">
          <MetricsPanel
            base={comparison.base}
            target={comparison.target}
            baseLabel={baseLabel}
            targetLabel={targetLabel}
          />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
};

const VariablesDiffPanel = ({
  diff,
}: {
  diff: VersionComparisonDto["variablesDiff"];
}) => {
  const total =
    diff.added.length
    + diff.removed.length
    + diff.changed.length
    + diff.unchanged.length;

  if (total === 0) {
    return (
      <Center py="xl">
        <Text c="dimmed">Neither version uses variables</Text>
      </Center>
    );
  }

  return (
    <Grid>
      <Grid.Col span={{ base: 12, md: 6 }}>
        <DiffSection
          title="Added"
          color="green"
          variables={diff.added}
          empty="No new variables"
        />
        <DiffSection
          title="Removed"
          color="red"
          variables={diff.removed}
          empty="No removed variables"
        />
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 6 }}>
        <ChangedSection changes={diff.changed} />
        <DiffSection
          title="Unchanged"
          color="gray"
          variables={diff.unchanged}
          empty="No unchanged variables"
        />
      </Grid.Col>
    </Grid>
  );
};

const DiffSection = ({
  title,
  color,
  variables,
  empty,
}: {
  title: string;
  color: string;
  variables: PromptVariableDto[];
  empty: string;
}) => (
  <Paper withBorder p="sm" mb="sm">
    <Group justify="space-between" mb="xs">
      <Text fw={600}>{title}</Text>
      <Badge color={color} variant="light">
        {variables.length}
      </Badge>
    </Group>
    {variables.length === 0 ? (
      <Text size="sm" c="dimmed">
        {empty}
      </Text>
    ) : (
      <Stack gap={6}>
        {variables.map((v) => (
          <Group key={v.name} gap="xs" wrap="wrap">
            <Badge color="violet" variant={v.required ? "filled" : "light"}>
              {`{{${v.name}}}`}
            </Badge>
            {v.defaultValue !== null && (
              <Text size="xs" c="dimmed">
                default: {v.defaultValue}
              </Text>
            )}
            {v.description && (
              <Text size="xs" c="dimmed">
                — {v.description}
              </Text>
            )}
          </Group>
        ))}
      </Stack>
    )}
  </Paper>
);

const ChangedSection = ({
  changes,
}: {
  changes: VersionComparisonDto["variablesDiff"]["changed"];
}) => (
  <Paper withBorder p="sm" mb="sm">
    <Group justify="space-between" mb="xs">
      <Text fw={600}>Changed</Text>
      <Badge color="yellow" variant="light">
        {changes.length}
      </Badge>
    </Group>
    {changes.length === 0 ? (
      <Text size="sm" c="dimmed">
        No field changes on shared variables
      </Text>
    ) : (
      <Table withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Variable</Table.Th>
            <Table.Th>Field</Table.Th>
            <Table.Th>Base</Table.Th>
            <Table.Th>Target</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {changes.flatMap((c) =>
            (
              ["description", "defaultValue", "required"] as const
            )
              .filter((field) => c.base[field] !== c.target[field])
              .map((field) => (
                <Table.Tr key={`${c.name}.${field}`}>
                  <Table.Td>
                    <Badge color="violet" variant="light">
                      {`{{${c.name}}}`}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{field}</Table.Td>
                  <Table.Td>
                    <Text size="xs">{String(c.base[field] ?? "—")}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{String(c.target[field] ?? "—")}</Text>
                  </Table.Td>
                </Table.Tr>
              )),
          )}
        </Table.Tbody>
      </Table>
    )}
  </Paper>
);

interface MetricsPanelProps {
  base: VersionComparisonDto["base"];
  target: VersionComparisonDto["target"];
  baseLabel: string;
  targetLabel: string;
}

const MetricsPanel = ({ base, target, baseLabel, targetLabel }: MetricsPanelProps) => {
  // Metrics tab is a property table — derived client-side from `base` /
  // `target` rather than pre-computed server-side. Each row is a metric
  // name + the two values; UI highlights mismatched rows so reviewers
  // see structural differences at a glance.
  const rows: Array<{
    label: string;
    base: string | number;
    target: string | number;
  }> = [
    { label: "Status", base: base.status, target: target.status },
    {
      label: "Generator model",
      base: base.generatorModel ?? "—",
      target: target.generatorModel ?? "—",
    },
    {
      label: "Source length (chars)",
      base: base.sourcePrompt.length,
      target: target.sourcePrompt.length,
    },
    { label: "Variables", base: base.variables.length, target: target.variables.length },
    {
      label: "BRAID graph",
      base: base.braidGraph ? "yes" : "no",
      target: target.braidGraph ? "yes" : "no",
    },
    {
      label: "Created",
      base: new Date(base.createdAt).toLocaleString(),
      target: new Date(target.createdAt).toLocaleString(),
    },
    {
      label: "Updated",
      base: new Date(base.updatedAt).toLocaleString(),
      target: new Date(target.updatedAt).toLocaleString(),
    },
  ];

  return (
    <Table withTableBorder>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Metric</Table.Th>
          <Table.Th>{baseLabel}</Table.Th>
          <Table.Th>{targetLabel}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((r) => {
          const differs = String(r.base) !== String(r.target);
          return (
            <Table.Tr key={r.label}>
              <Table.Td>
                <Text size="sm" fw={differs ? 600 : 400}>
                  {r.label}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm" c={differs ? "blue" : undefined}>
                  {r.base}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm" c={differs ? "blue" : undefined}>
                  {r.target}
                </Text>
              </Table.Td>
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
};

