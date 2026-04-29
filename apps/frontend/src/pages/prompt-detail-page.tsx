import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useAtomValue, useSetAtom } from "jotai";
import { useNavigate, useParams } from "react-router-dom";
import { notifications } from "@mantine/notifications";
import { VERSION_STATUSES, type VersionStatus } from "@plexus/shared-types";
import {
  fetchPromptDetailAtom,
  promoteVersionAtom,
  promptDetailRefreshAtom,
  type PromptDetail,
} from "../atoms/prompts.atoms.js";
import { ApiError } from "../lib/api-client.js";

const statusColor: Record<VersionStatus, string> = {
  draft: "gray",
  development: "blue",
  staging: "yellow",
  production: "green",
};

// `draft` is the initial state and cannot be re-entered (domain rule).
// Every other status is reachable in either direction so the workflow
// supports both promotions and rollback (e.g. `production → staging`).
const PROMOTABLE_STATUSES: ReadonlyArray<Exclude<VersionStatus, "draft">> = VERSION_STATUSES.filter(
  (s): s is Exclude<VersionStatus, "draft"> => s !== "draft",
);

export const PromptDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const fetchDetail = useSetAtom(fetchPromptDetailAtom);
  const promote = useSetAtom(promoteVersionAtom);
  const refresh = useAtomValue(promptDetailRefreshAtom);
  const [detail, setDetail] = useState<PromptDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    fetchDetail(id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? err.message : "Failed to load";
        notifications.show({ color: "red", title: "Error", message });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, fetchDetail, refresh]);

  const handlePromote = async (version: string, targetStatus: Exclude<VersionStatus, "draft">) => {
    if (!id) return;
    try {
      await promote({ promptId: id, version, input: { targetStatus } });
      notifications.show({ color: "green", title: "Promoted", message: `${version} → ${targetStatus}` });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to promote";
      notifications.show({ color: "red", title: "Error", message });
    }
  };

  if (loading) {
    return <Center py="xl"><Loader /></Center>;
  }
  if (!detail) {
    return <Text>Prompt not found</Text>;
  }

  const { prompt, versions } = detail;

  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Title order={2}>{prompt.name}</Title>
          <Text c="dimmed">{prompt.description || "No description"}</Text>
          <Group gap="xs" mt="xs">
            <Badge variant="light">{prompt.taskType}</Badge>
            {prompt.productionVersion && (
              <Badge color="green">prod: {prompt.productionVersion}</Badge>
            )}
          </Group>
        </div>
        <Button onClick={() => navigate(`/prompts/${prompt.id}/versions/new`)}>
          New Version
        </Button>
      </Group>

      <Title order={4} mt="md">Versions</Title>
      <Table withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Version</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th>Created</Table.Th>
            <Table.Th>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {versions.map((v) => (
            <Table.Tr key={v.id}>
              <Table.Td>
                <Text
                  style={{ cursor: "pointer", textDecoration: "underline" }}
                  onClick={() => navigate(`/prompts/${prompt.id}/versions/${v.version}`)}
                >
                  {v.name?.trim() ? `${v.name} (${v.version})` : v.version}
                </Text>
              </Table.Td>
              <Table.Td>
                <Badge color={statusColor[v.status]}>{v.status}</Badge>
              </Table.Td>
              <Table.Td>{new Date(v.createdAt).toLocaleDateString()}</Table.Td>
              <Table.Td>
                <Group gap="xs">
                  {PROMOTABLE_STATUSES.filter((target) => target !== v.status).map((target) => (
                    <Button
                      key={target}
                      size="xs"
                      variant={target === "production" ? "filled" : "light"}
                      color={statusColor[target]}
                      onClick={() => handlePromote(v.version, target)}
                    >
                      → {target}
                    </Button>
                  ))}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
};
