import { useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Menu,
  Paper,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { IconDotsVertical } from "@tabler/icons-react";
import { useSetAtom } from "jotai";
import { notifications } from "@mantine/notifications";
import { useNavigate } from "react-router-dom";
import {
  VERSION_STATUSES,
  type PromptVersionDto,
  type VersionStatus,
} from "@plexus/shared-types";
import { promoteVersionAtom } from "../atoms/prompts.atoms.js";
import { requestVersionApprovalAtom } from "../atoms/organizations.atoms.js";
import { ApiError } from "../lib/api-client.js";
import { usePermission } from "../lib/use-permission.js";

const statusColor: Record<VersionStatus, string> = {
  draft: "gray",
  development: "blue",
  staging: "yellow",
  production: "green",
};

const PROMOTABLE_STATUSES: ReadonlyArray<Exclude<VersionStatus, "draft">> =
  VERSION_STATUSES.filter(
    (s): s is Exclude<VersionStatus, "draft"> => s !== "draft",
  );

interface Props {
  promptId: string;
  versions: PromptVersionDto[];
  currentVersion: string;
  productionVersion: string | null;
  approvalPolicyActive: boolean;
}

export const VersionHistoryPanel = ({
  promptId,
  versions,
  currentVersion,
  productionVersion,
  approvalPolicyActive,
}: Props) => {
  const navigate = useNavigate();
  const promote = useSetAtom(promoteVersionAtom);
  const requestApproval = useSetAtom(requestVersionApprovalAtom);
  const canPromote = usePermission("prompt:promote");

  const sorted = [...versions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const handlePromote = async (
    version: string,
    targetStatus: Exclude<VersionStatus, "draft">,
  ) => {
    try {
      await promote({ promptId, version, input: { targetStatus } });
      notifications.show({
        color: "green",
        title: "Promoted",
        message: `${version} → ${targetStatus}`,
      });
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
      const message =
        err instanceof ApiError ? err.message : "Failed to request approval";
      notifications.show({ color: "red", title: "Error", message });
    }
  };

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Text fw={600} size="sm">
          History
        </Text>
        <Text size="xs" c="dimmed">
          {versions.length} version{versions.length === 1 ? "" : "s"}
        </Text>
      </Group>

      {versions.length >= 2 && (
        <CompareControls
          promptId={promptId}
          versionLabels={sorted.map((v) => v.version)}
          currentVersion={currentVersion}
        />
      )}

      <Stack gap={6}>
        {sorted.map((v) => {
          const isCurrent = v.version === currentVersion;
          const isProduction = v.version === productionVersion;
          const label = v.name?.trim() ? `${v.name}` : v.version;
          const sub = v.name?.trim() ? v.version : null;

          return (
            <Paper
              key={v.id}
              withBorder
              p="xs"
              style={{
                cursor: isCurrent ? "default" : "pointer",
                borderColor: isCurrent ? "var(--mantine-color-blue-5)" : undefined,
                backgroundColor: isCurrent
                  ? "var(--mantine-color-blue-light)"
                  : undefined,
              }}
              onClick={() => {
                if (!isCurrent) navigate(`/prompts/${promptId}/versions/${v.version}`);
              }}
            >
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                  <Group gap={6} wrap="nowrap">
                    <Text size="sm" fw={500} truncate>
                      {label}
                    </Text>
                    {isCurrent && (
                      <Badge size="xs" color="blue">
                        current
                      </Badge>
                    )}
                    {isProduction && (
                      <Badge size="xs" color="green">
                        prod
                      </Badge>
                    )}
                  </Group>
                  {sub && (
                    <Text size="xs" c="dimmed">
                      {sub}
                    </Text>
                  )}
                  <Group gap={6}>
                    <Badge size="xs" color={statusColor[v.status]}>
                      {v.status}
                    </Badge>
                    <Text size="xs" c="dimmed">
                      {new Date(v.createdAt).toLocaleDateString()}
                    </Text>
                  </Group>
                </Stack>
                {canPromote && (
                  <Menu shadow="md" position="bottom-end" withinPortal>
                    <Menu.Target>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="sm"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <IconDotsVertical size={14} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Label>Promote</Menu.Label>
                      {PROMOTABLE_STATUSES.filter((t) => t !== v.status).map(
                        (target) => {
                          if (target === "production" && approvalPolicyActive) {
                            return (
                              <Menu.Item
                                key={target}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleRequestApproval(v.version);
                                }}
                              >
                                Request approval → production
                              </Menu.Item>
                            );
                          }
                          return (
                            <Menu.Item
                              key={target}
                              onClick={(e) => {
                                e.stopPropagation();
                                void handlePromote(v.version, target);
                              }}
                            >
                              → {target}
                            </Menu.Item>
                          );
                        },
                      )}
                    </Menu.Dropdown>
                  </Menu>
                )}
              </Group>
            </Paper>
          );
        })}
      </Stack>
    </Stack>
  );
};

const CompareControls = ({
  promptId,
  versionLabels,
  currentVersion,
}: {
  promptId: string;
  versionLabels: string[];
  currentVersion: string;
}) => {
  const navigate = useNavigate();
  const others = versionLabels.filter((v) => v !== currentVersion);
  const [target, setTarget] = useState<string | null>(others[0] ?? null);
  const data = others.map((v) => ({ value: v, label: v }));

  return (
    <Paper withBorder p="xs">
      <Stack gap={6}>
        <Text size="xs" fw={600} c="dimmed">
          Compare with
        </Text>
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <Select
            size="xs"
            value={target}
            onChange={setTarget}
            data={data}
            placeholder="version"
            style={{ flex: 1 }}
          />
          <Button
            size="xs"
            disabled={!target}
            onClick={() =>
              navigate(
                `/prompts/${promptId}/compare?base=${encodeURIComponent(currentVersion)}&target=${encodeURIComponent(target!)}`,
              )
            }
          >
            Compare
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
};
