import { Group, Paper, Stack, Text } from "@mantine/core";
import { useAtomValue } from "jotai";
import type { OrganizationMembershipEventDto } from "@plexus/shared-types";
import { eventsAtom } from "../atoms/organizations.atoms.js";

// Switch maps each event type to a one-line natural language summary.
// Domain invariant guarantees the discriminated fields are populated
// for the matching event type (joined/role_changed/removed/transferred
// always have `targetUserId`; invited/cancelled always have
// `targetEmail`).
const eventLabel = (ev: OrganizationMembershipEventDto): string => {
  switch (ev.eventType) {
    case "invited":
      return `Invited ${ev.targetEmail} as ${ev.newRole}`;
    case "cancelled":
      return `Cancelled invitation to ${ev.targetEmail}`;
    case "joined":
      return `…${ev.targetUserId?.slice(-8)} joined as ${ev.newRole}`;
    case "role_changed":
      return `…${ev.targetUserId?.slice(-8)}: ${ev.oldRole} → ${ev.newRole}`;
    case "removed":
      return `Removed …${ev.targetUserId?.slice(-8)} (was ${ev.oldRole})`;
    case "ownership_transferred":
      return `Ownership transferred to …${ev.targetUserId?.slice(-8)} (was ${ev.oldRole})`;
  }
};

export const OrgEventsTimeline = () => {
  const events = useAtomValue(eventsAtom);
  if (events.length === 0) {
    return (
      <Text c="dimmed" ta="center" py="lg">
        No membership activity recorded yet.
      </Text>
    );
  }
  return (
    <Stack gap="xs">
      {events.map((ev) => (
        <Paper key={ev.id} withBorder p="sm">
          <Group justify="space-between">
            <Text size="sm">{eventLabel(ev)}</Text>
            <Text size="xs" c="dimmed">
              {new Date(ev.occurredAt).toLocaleString()}
            </Text>
          </Group>
          <Text size="xs" c="dimmed">
            by …{ev.actorUserId.slice(-8)}
          </Text>
        </Paper>
      ))}
    </Stack>
  );
};
