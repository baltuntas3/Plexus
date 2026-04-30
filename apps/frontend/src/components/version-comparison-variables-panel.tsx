import {
  Badge,
  Center,
  Grid,
  Group,
  Paper,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import type {
  PromptVariableDto,
  VersionComparisonDto,
} from "@plexus/shared-types";

// Variables tab of the side-by-side comparison. Consumes the server-
// computed `variablesDiff` (added / removed / changed / unchanged
// partition) and renders four sections side-by-side. Per-field changes
// expand into a table row per differing field so reviewers don't have
// to spot subtle description/default-value tweaks themselves.
export const VariablesDiffPanel = ({
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
