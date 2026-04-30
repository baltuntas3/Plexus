import { Table, Text } from "@mantine/core";
import type { VersionComparisonDto } from "@plexus/shared-types";

interface MetricsPanelProps {
  base: VersionComparisonDto["base"];
  target: VersionComparisonDto["target"];
  baseLabel: string;
  targetLabel: string;
}

// Property table for the "Metrics" tab of the comparison view. Rows
// are derived client-side from `base` / `target` rather than pre-
// computed server-side — the comparison endpoint already ships the
// full version DTOs, and the metric definitions (character count,
// variable count, etc.) are display concerns. UI highlights mismatched
// rows so reviewers see structural differences at a glance.
export const MetricsPanel = ({ base, target, baseLabel, targetLabel }: MetricsPanelProps) => {
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
