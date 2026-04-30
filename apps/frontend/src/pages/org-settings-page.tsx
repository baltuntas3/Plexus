import { Suspense } from "react";
import {
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useAtomValue } from "jotai";
import { currentOrganizationAtom } from "../atoms/auth.atoms.js";
import { ApprovalPolicyForm } from "../components/approval-policy-form.js";
import { ApprovalRequestsTable } from "../components/approval-requests-table.js";
import { InviteMemberModal } from "../components/invite-member-modal.js";
import { OrgEventsTimeline } from "../components/org-events-timeline.js";
import { OrgInvitationsTable } from "../components/org-invitations-table.js";
import { OrgMembersTable } from "../components/org-members-table.js";
import { usePermission } from "../lib/use-permission.js";

const PanelFallback = () => (
  <Center py="xl">
    <Loader size="sm" />
  </Center>
);

export const OrgSettingsPage = () => {
  const org = useAtomValue(currentOrganizationAtom);
  const [opened, { open, close }] = useDisclosure(false);
  const canEditPolicy = usePermission("policy:edit");
  const canSeeApprovals = usePermission("version:approve");

  if (!org) {
    return <Text>No active organization</Text>;
  }

  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Group gap="xs">
            <Title order={2}>{org.name}</Title>
            {org.approvalPolicy && (
              <Badge color="violet" variant="light">
                {org.approvalPolicy.requiredApprovals}-approver gate
              </Badge>
            )}
          </Group>
          <Text size="sm" c="dimmed">
            slug: {org.slug}
          </Text>
        </div>
        <Button onClick={open}>Invite member</Button>
      </Group>

      <Tabs defaultValue="members">
        <Tabs.List>
          <Tabs.Tab value="members">Members</Tabs.Tab>
          <Tabs.Tab value="invitations">Invitations</Tabs.Tab>
          <Tabs.Tab value="audit">Audit log</Tabs.Tab>
          {canEditPolicy && (
            <Tabs.Tab value="policy">Approval policy</Tabs.Tab>
          )}
          {canSeeApprovals && (
            <Tabs.Tab value="approvals">Pending approvals</Tabs.Tab>
          )}
        </Tabs.List>

        <Tabs.Panel value="members" pt="md">
          <Suspense fallback={<PanelFallback />}>
            <OrgMembersTable />
          </Suspense>
        </Tabs.Panel>
        <Tabs.Panel value="invitations" pt="md">
          <Suspense fallback={<PanelFallback />}>
            <OrgInvitationsTable />
          </Suspense>
        </Tabs.Panel>
        <Tabs.Panel value="audit" pt="md">
          <Suspense fallback={<PanelFallback />}>
            <OrgEventsTimeline />
          </Suspense>
        </Tabs.Panel>
        {canEditPolicy && (
          <Tabs.Panel value="policy" pt="md">
            <ApprovalPolicyForm />
          </Tabs.Panel>
        )}
        {canSeeApprovals && (
          <Tabs.Panel value="approvals" pt="md">
            <Suspense fallback={<PanelFallback />}>
              <ApprovalRequestsTable />
            </Suspense>
          </Tabs.Panel>
        )}
      </Tabs>

      <InviteMemberModal opened={opened} onClose={close} />
    </Stack>
  );
};
