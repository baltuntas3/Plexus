import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useAtomValue, useSetAtom } from "jotai";
import { loadable } from "jotai/utils";
import { useNavigate, useParams } from "react-router-dom";
import { notifications } from "@mantine/notifications";
import { VERSION_STATUSES, type VersionStatus } from "@plexus/shared-types";
import {
  getPromptDetailAtom,
  promoteVersionAtom,
} from "../atoms/prompts.atoms.js";
import { requestVersionApprovalAtom } from "../atoms/organizations.atoms.js";
import { currentOrganizationAtom } from "../atoms/auth.atoms.js";
import { ApiError } from "../lib/api-client.js";
import { usePermission } from "../lib/use-permission.js";

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

interface DetailViewProps {
  promptId: string;
}

const DetailView = ({ promptId }: DetailViewProps) => {
  const navigate = useNavigate();
  const promote = useSetAtom(promoteVersionAtom);
  const requestApproval = useSetAtom(requestVersionApprovalAtom);
  const org = useAtomValue(currentOrganizationAtom);

  // `loadable` keeps the previous data visible while a refetch is in
  // flight (after a promote bumps the refresh counter), so the page does
  // not flash to a loader on every mutation. Re-memoised per `promptId`
  // so route navigations subscribe to the right prompt's atom.
  const detailAtom = useMemo(
    () => loadable(getPromptDetailAtom(promptId)),
    [promptId],
  );
  const detail = useAtomValue(detailAtom);
  // Mirrors the backend `requirePermission` middleware. Buttons disable
  // when the role hasn't loaded yet (defensive — server still rejects a
  // stray click).
  const canPromote = usePermission("prompt:promote");
  const canCreateVersion = usePermission("version:edit");
  // When the org has an active approval policy, the `→ production`
  // button is replaced by `Request approval` — the direct path is
  // server-side rejected with VERSION_APPROVAL_REQUIRED, but blocking
  // the click here gives a clearer affordance.
  const requiresApproval = org?.approvalPolicy !== null && org?.approvalPolicy !== undefined;

  const handlePromote = async (version: string, targetStatus: Exclude<VersionStatus, "draft">) => {
    try {
      await promote({ promptId, version, input: { targetStatus } });
      notifications.show({ color: "green", title: "Promoted", message: `${version} → ${targetStatus}` });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to promote";
      notifications.show({ color: "red", title: "Error", message });
    }
  };

  const handleRequestApproval = async (version: string) => {
    try {
      const request = await requestApproval({ promptId, version });
      notifications.show({
        color: "green",
        title: "Approval requested",
        message: `Need ${request.requiredApprovals} approver(s) before ${version} promotes`,
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to request approval";
      notifications.show({ color: "red", title: "Error", message });
    }
  };

  if (detail.state === "loading") {
    return <Center py="xl"><Loader /></Center>;
  }
  if (detail.state === "hasError") {
    const message =
      detail.error instanceof ApiError ? detail.error.message : "Failed to load prompt";
    return <Text c="red">{message}</Text>;
  }

  const { prompt, versions } = detail.data;

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
        <Button
          onClick={() => navigate(`/prompts/${prompt.id}/versions/new`)}
          disabled={!canCreateVersion}
        >
          New Version
        </Button>
      </Group>

      {versions.length >= 2 && (
        <CompareToolbar promptId={prompt.id} versionLabels={versions.map((v) => v.version)} />
      )}

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
                  {PROMOTABLE_STATUSES.filter((target) => target !== v.status).map((target) => {
                    if (target === "production" && requiresApproval) {
                      return (
                        <Button
                          key={target}
                          size="xs"
                          variant="filled"
                          color="violet"
                          onClick={() => void handleRequestApproval(v.version)}
                          disabled={!canPromote}
                        >
                          Request approval
                        </Button>
                      );
                    }
                    return (
                      <Button
                        key={target}
                        size="xs"
                        variant={target === "production" ? "filled" : "light"}
                        color={statusColor[target]}
                        onClick={() => handlePromote(v.version, target)}
                        disabled={!canPromote}
                      >
                        → {target}
                      </Button>
                    );
                  })}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
};

// Lightweight pair-picker that navigates to the side-by-side comparison
// page. Lives here rather than a separate component because it has one
// caller and trivial state — three Mantine controls and a navigate.
const CompareToolbar = ({
  promptId,
  versionLabels,
}: {
  promptId: string;
  versionLabels: string[];
}) => {
  const navigate = useNavigate();
  const [base, setBase] = useState<string | null>(versionLabels[0] ?? null);
  const [target, setTarget] = useState<string | null>(versionLabels[1] ?? null);

  const data = versionLabels.map((v) => ({ value: v, label: v }));
  const canCompare = base !== null && target !== null && base !== target;

  return (
    <Paper withBorder p="sm" mt="md">
      <Group gap="sm" align="flex-end">
        <Select
          label="Base"
          size="xs"
          value={base}
          onChange={setBase}
          data={data}
          w={140}
        />
        <Text size="sm" c="dimmed" pb={6}>
          vs
        </Text>
        <Select
          label="Target"
          size="xs"
          value={target}
          onChange={setTarget}
          data={data}
          w={140}
        />
        <Button
          size="xs"
          disabled={!canCompare}
          onClick={() =>
            navigate(
              `/prompts/${promptId}/compare?base=${encodeURIComponent(base!)}&target=${encodeURIComponent(target!)}`,
            )
          }
        >
          Compare
        </Button>
      </Group>
    </Paper>
  );
};

export const PromptDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Text>Invalid route</Text>;
  return <DetailView promptId={id} />;
};
