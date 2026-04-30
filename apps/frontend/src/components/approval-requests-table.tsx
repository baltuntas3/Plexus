import { Badge, Button, Group, Stack, Table, Text, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useAtomValue, useSetAtom } from "jotai";
import type { VersionApprovalRequestDto } from "@plexus/shared-types";
import { userAtom } from "../atoms/auth.atoms.js";
import {
  approveVersionRequestAtom,
  cancelVersionRequestAtom,
  pendingApprovalRequestsAtom,
  rejectVersionRequestAtom,
} from "../atoms/organizations.atoms.js";
import { ApiError } from "../lib/api-client.js";
import { usePermission } from "../lib/use-permission.js";

const statusColor: Record<VersionApprovalRequestDto["status"], string> = {
  pending: "blue",
  approved: "green",
  rejected: "red",
  cancelled: "gray",
};

// Inbox of pending production-promotion requests. Each row shows:
//   • the version being promoted (prompt id + label slice)
//   • the requester (id slice)
//   • progress (`N / M approvals`)
//   • per-row actions gated by role and request ownership
//
// Approve/Reject is shown to users with `version:approve` *and* who are
// not the requester (separation of duty). Cancel is shown to the
// requester (their own row) or admins (`approval:cancel:any`).
export const ApprovalRequestsTable = () => {
  const requests = useAtomValue(pendingApprovalRequestsAtom);
  const user = useAtomValue(userAtom);
  const approve = useSetAtom(approveVersionRequestAtom);
  const reject = useSetAtom(rejectVersionRequestAtom);
  const cancel = useSetAtom(cancelVersionRequestAtom);
  const canVote = usePermission("version:approve");
  const canCancelAny = usePermission("approval:cancel:any");

  if (requests.length === 0) {
    return (
      <Text c="dimmed" ta="center" py="lg">
        No pending approval requests.
      </Text>
    );
  }

  const handle = async (
    action: (id: string) => Promise<VersionApprovalRequestDto>,
    requestId: string,
    actionLabel: string,
  ) => {
    try {
      const result = await action(requestId);
      notifications.show({
        color: "green",
        title: actionLabel,
        message: `Request is now ${result.status}`,
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : `Failed to ${actionLabel.toLowerCase()}`;
      notifications.show({ color: "red", title: "Error", message });
    }
  };

  return (
    <Table withTableBorder>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Prompt / Version</Table.Th>
          <Table.Th>Requester</Table.Th>
          <Table.Th>Status</Table.Th>
          <Table.Th>Progress</Table.Th>
          <Table.Th>Actions</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {requests.map((r) => {
          const isOwnRequest = r.requestedBy === user?.id;
          const alreadyVoted =
            user !== null
            && (r.approvals.some((v) => v.userId === user.id)
              || r.rejections.some((v) => v.userId === user.id));
          const showVote = canVote && !isOwnRequest && !alreadyVoted;
          const showCancel = isOwnRequest || canCancelAny;
          return (
            <Table.Tr key={r.id}>
              <Table.Td>
                <Stack gap={2}>
                  <Text size="sm">{r.promptName}</Text>
                  <Text size="xs" c="dimmed">
                    {r.versionLabel}
                  </Text>
                </Stack>
              </Table.Td>
              <Table.Td>
                <Text size="sm">…{r.requestedBy.slice(-8)}</Text>
              </Table.Td>
              <Table.Td>
                <Badge color={statusColor[r.status]}>{r.status}</Badge>
              </Table.Td>
              <Table.Td>
                <Tooltip
                  label={
                    r.approvals.length === 0
                      ? "No votes yet"
                      : r.approvals
                          .map((v) => `…${v.userId.slice(-6)}`)
                          .join(", ")
                  }
                >
                  <Text size="sm">
                    {r.approvals.length} / {r.requiredApprovals}
                  </Text>
                </Tooltip>
              </Table.Td>
              <Table.Td>
                <Group gap="xs">
                  {showVote && (
                    <>
                      <Button
                        size="xs"
                        color="green"
                        variant="light"
                        onClick={() =>
                          void handle(approve, r.id, "Approved")
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        size="xs"
                        color="red"
                        variant="light"
                        onClick={() => void handle(reject, r.id, "Rejected")}
                      >
                        Reject
                      </Button>
                    </>
                  )}
                  {showCancel && (
                    <Button
                      size="xs"
                      color="gray"
                      variant="subtle"
                      onClick={() => void handle(cancel, r.id, "Cancelled")}
                    >
                      Cancel
                    </Button>
                  )}
                </Group>
              </Table.Td>
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
};
