import { useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useAtomValue, useSetAtom } from "jotai";
import {
  ASSIGNABLE_ROLES,
  type AssignableOrganizationRole,
  type OrganizationMemberDto,
} from "@plexus/shared-types";
import {
  membersAtom,
  removeMemberAtom,
  transferOwnershipAtom,
  updateMemberRoleAtom,
} from "../atoms/organizations.atoms.js";
import { userAtom } from "../atoms/auth.atoms.js";
import { ApiError } from "../lib/api-client.js";
import { roleColor } from "../lib/organization-role-colors.js";

export const OrgMembersTable = () => {
  const members = useAtomValue(membersAtom);
  const currentUser = useAtomValue(userAtom);
  const updateRole = useSetAtom(updateMemberRoleAtom);
  const removeMember = useSetAtom(removeMemberAtom);
  const transferOwnership = useSetAtom(transferOwnershipAtom);
  const [transferTarget, setTransferTarget] = useState<OrganizationMemberDto | null>(
    null,
  );

  // Self-edit ban is enforced by the backend; graying out the row in
  // the UI prevents an avoidable round-trip and signals "no action
  // available here" without surfacing a 403.
  const isSelf = (m: OrganizationMemberDto): boolean =>
    m.userId === currentUser?.id;

  const handleRoleChange = async (
    member: OrganizationMemberDto,
    newRole: string | null,
  ) => {
    if (!newRole || !ASSIGNABLE_ROLES.includes(newRole as never)) return;
    try {
      await updateRole({
        memberId: member.id,
        role: newRole as AssignableOrganizationRole,
      });
      notifications.show({
        color: "green",
        title: "Role updated",
        message: `${member.userId.slice(-6)} → ${newRole}`,
      });
    } catch (err) {
      notifications.show({
        color: "red",
        title: "Error",
        message: err instanceof ApiError ? err.message : "Failed to change role",
      });
    }
  };

  const handleRemove = async (member: OrganizationMemberDto) => {
    if (!confirm(`Remove ${member.userId.slice(-6)} from the organization?`)) {
      return;
    }
    try {
      await removeMember(member.id);
      notifications.show({ color: "green", title: "Removed", message: "Member removed" });
    } catch (err) {
      notifications.show({
        color: "red",
        title: "Error",
        message: err instanceof ApiError ? err.message : "Failed to remove",
      });
    }
  };

  const handleTransfer = async () => {
    if (!transferTarget) return;
    try {
      await transferOwnership(transferTarget.userId);
      notifications.show({
        color: "green",
        title: "Ownership transferred",
        message: `New owner: ${transferTarget.userId.slice(-6)}`,
      });
      setTransferTarget(null);
    } catch (err) {
      notifications.show({
        color: "red",
        title: "Error",
        message: err instanceof ApiError ? err.message : "Transfer failed",
      });
    }
  };

  return (
    <>
      <Table withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>User</Table.Th>
            <Table.Th>Role</Table.Th>
            <Table.Th>Joined</Table.Th>
            <Table.Th>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {members.map((m) => {
            const self = isSelf(m);
            const isOwner = m.role === "owner";
            return (
              <Table.Tr key={m.id} style={self ? { opacity: 0.7 } : undefined}>
                <Table.Td>
                  <Group gap="xs">
                    <Text size="sm">…{m.userId.slice(-8)}</Text>
                    {self && (
                      <Badge size="xs" variant="light">
                        you
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>
                  {isOwner || self ? (
                    <Badge color={roleColor[m.role]}>{m.role}</Badge>
                  ) : (
                    <Select
                      size="xs"
                      value={m.role}
                      data={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: r }))}
                      onChange={(v) => void handleRoleChange(m, v)}
                      w={120}
                    />
                  )}
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    {new Date(m.joinedAt).toLocaleDateString()}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    {!self && !isOwner && (
                      <Tooltip label="Transfer ownership to this member">
                        <Button
                          size="xs"
                          variant="subtle"
                          onClick={() => setTransferTarget(m)}
                        >
                          → owner
                        </Button>
                      </Tooltip>
                    )}
                    {!self && !isOwner && (
                      <Tooltip label="Remove from organization">
                        <ActionIcon
                          color="red"
                          variant="subtle"
                          size="lg"
                          onClick={() => void handleRemove(m)}
                        >
                          ×
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
      <Modal
        opened={transferTarget !== null}
        onClose={() => setTransferTarget(null)}
        title="Transfer ownership"
        size="md"
      >
        <Stack>
          <Text>
            You will become an admin and <b>…{transferTarget?.userId.slice(-8)}</b>{" "}
            will become the new owner. Only one user can be owner at a time —
            this transfer is not reversible without a counter-transfer from the
            new owner.
          </Text>
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setTransferTarget(null)}>
              Cancel
            </Button>
            <Button color="violet" onClick={() => void handleTransfer()}>
              Confirm transfer
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};
