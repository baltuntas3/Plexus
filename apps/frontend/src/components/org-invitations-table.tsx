import { Badge, Button, Table, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useAtomValue, useSetAtom } from "jotai";
import type { OrganizationInvitationDto } from "@plexus/shared-types";
import {
  cancelInvitationAtom,
  invitationsAtom,
} from "../atoms/organizations.atoms.js";
import { ApiError } from "../lib/api-client.js";
import { roleColor } from "../lib/organization-role-colors.js";

export const OrgInvitationsTable = () => {
  const invitations = useAtomValue(invitationsAtom);
  const cancel = useSetAtom(cancelInvitationAtom);

  const handleCancel = async (invitation: OrganizationInvitationDto) => {
    if (!confirm(`Cancel invitation to ${invitation.email}?`)) return;
    try {
      await cancel(invitation.id);
      notifications.show({ color: "green", title: "Cancelled", message: invitation.email });
    } catch (err) {
      notifications.show({
        color: "red",
        title: "Error",
        message: err instanceof ApiError ? err.message : "Failed to cancel",
      });
    }
  };

  if (invitations.length === 0) {
    return (
      <Text c="dimmed" ta="center" py="lg">
        No invitations yet.
      </Text>
    );
  }

  return (
    <Table withTableBorder>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Email</Table.Th>
          <Table.Th>Role</Table.Th>
          <Table.Th>Status</Table.Th>
          <Table.Th>Expires</Table.Th>
          <Table.Th>Actions</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {invitations.map((inv) => (
          <Table.Tr key={inv.id}>
            <Table.Td>
              <Text size="sm">{inv.email}</Text>
            </Table.Td>
            <Table.Td>
              <Badge color={roleColor[inv.role]}>{inv.role}</Badge>
            </Table.Td>
            <Table.Td>
              <Badge
                color={
                  inv.status === "pending"
                    ? "blue"
                    : inv.status === "accepted"
                    ? "green"
                    : "gray"
                }
                variant="light"
              >
                {inv.status}
              </Badge>
            </Table.Td>
            <Table.Td>
              <Text size="sm" c="dimmed">
                {new Date(inv.expiresAt).toLocaleDateString()}
              </Text>
            </Table.Td>
            <Table.Td>
              {inv.status === "pending" && (
                <Button
                  size="xs"
                  variant="subtle"
                  color="red"
                  onClick={() => void handleCancel(inv)}
                >
                  Cancel
                </Button>
              )}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
};
