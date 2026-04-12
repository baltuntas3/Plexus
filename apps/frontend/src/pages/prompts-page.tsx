import { Suspense, useState } from "react";
import {
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useAtom, useAtomValue } from "jotai";
import { useNavigate } from "react-router-dom";
import {
  promptsListAtom,
  promptsListSearchAtom,
} from "../atoms/prompts.atoms.js";
import { NewPromptModal } from "../components/new-prompt-modal.js";

const PromptsTable = () => {
  const data = useAtomValue(promptsListAtom);
  const navigate = useNavigate();

  if (data.items.length === 0) {
    return (
      <Center py="xl">
        <Text c="dimmed">No prompts yet. Create your first one.</Text>
      </Center>
    );
  }

  return (
    <Table highlightOnHover withTableBorder>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Name</Table.Th>
          <Table.Th>Task Type</Table.Th>
          <Table.Th>Production</Table.Th>
          <Table.Th>Created</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {data.items.map((p) => (
          <Table.Tr
            key={p.id}
            style={{ cursor: "pointer" }}
            onClick={() => navigate(`/prompts/${p.id}`)}
          >
            <Table.Td>{p.name}</Table.Td>
            <Table.Td>
              <Badge variant="light">{p.taskType}</Badge>
            </Table.Td>
            <Table.Td>{p.productionVersion ?? "—"}</Table.Td>
            <Table.Td>{new Date(p.createdAt).toLocaleDateString()}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
};

export const PromptsPage = () => {
  const [search, setSearch] = useAtom(promptsListSearchAtom);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Prompts</Title>
        <Button onClick={() => setModalOpen(true)}>New Prompt</Button>
      </Group>

      <TextInput
        placeholder="Search by name..."
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        w={320}
      />

      <Suspense fallback={<Center py="xl"><Loader /></Center>}>
        <PromptsTable />
      </Suspense>

      <NewPromptModal opened={modalOpen} onClose={() => setModalOpen(false)} />
    </Stack>
  );
};
