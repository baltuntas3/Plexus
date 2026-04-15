import { Suspense, useState } from "react";
import {
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Progress,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useAtomValue } from "jotai";
import { useNavigate } from "react-router-dom";
import type { BenchmarkDto, BenchmarkStatus } from "@plexus/shared-types";
import { benchmarksListAtom } from "../atoms/benchmarks.atoms.js";
import { NewBenchmarkModal } from "../components/new-benchmark-modal.js";

const STATUS_COLOR: Record<BenchmarkStatus, string> = {
  draft: "yellow",
  queued: "gray",
  running: "blue",
  completed: "green",
  failed: "red",
};

const BenchmarksTable = () => {
  const data = useAtomValue(benchmarksListAtom);
  const navigate = useNavigate();

  if (data.items.length === 0) {
    return (
      <Center py="xl">
        <Text c="dimmed">No benchmarks yet. Create your first one.</Text>
      </Center>
    );
  }

  return (
    <Table highlightOnHover withTableBorder>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Name</Table.Th>
          <Table.Th>Status</Table.Th>
          <Table.Th>Progress</Table.Th>
          <Table.Th>Models</Table.Th>
          <Table.Th>Created</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {data.items.map((b: BenchmarkDto) => {
          const pct = b.progress.total === 0 ? 0 : (b.progress.completed / b.progress.total) * 100;
          return (
            <Table.Tr
              key={b.id}
              style={{ cursor: "pointer" }}
              onClick={() => navigate(`/benchmarks/${b.id}`)}
            >
              <Table.Td>{b.name}</Table.Td>
              <Table.Td>
                <Badge color={STATUS_COLOR[b.status]} variant="light">
                  {b.status}
                </Badge>
              </Table.Td>
              <Table.Td style={{ minWidth: 160 }}>
                <Stack gap={2}>
                  <Progress value={pct} size="sm" />
                  <Text size="xs" c="dimmed">
                    {b.progress.completed} / {b.progress.total}
                  </Text>
                </Stack>
              </Table.Td>
              <Table.Td>
                <Text size="xs">{b.solverModels.join(", ")}</Text>
              </Table.Td>
              <Table.Td>{new Date(b.createdAt).toLocaleString()}</Table.Td>
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
};

export const BenchmarksPage = () => {
  const [modalOpen, setModalOpen] = useState(false);
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Benchmarks</Title>
        <Button onClick={() => setModalOpen(true)}>New Benchmark</Button>
      </Group>

      <Suspense
        fallback={
          <Center py="xl">
            <Loader />
          </Center>
        }
      >
        <BenchmarksTable />
      </Suspense>

      <NewBenchmarkModal opened={modalOpen} onClose={() => setModalOpen(false)} />
    </Stack>
  );
};
