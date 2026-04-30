import { useState } from "react";
import { Button, Group, NumberInput, Paper, Stack, Switch, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useAtomValue, useSetAtom } from "jotai";
import { currentOrganizationAtom } from "../atoms/auth.atoms.js";
import { setApprovalPolicyAtom } from "../atoms/organizations.atoms.js";
import { ApiError } from "../lib/api-client.js";

const DEFAULT_REQUIRED_APPROVALS = 2;

// Single-form policy editor. The form mirrors `OrganizationDto.approvalPolicy`:
// a switch toggles the gate on/off, the number input picks the threshold.
// The aggregate enforces the 1..10 range — we surface the same min/max in
// the input so the slider doesn't allow invalid values to round-trip the
// server.
export const ApprovalPolicyForm = () => {
  const org = useAtomValue(currentOrganizationAtom);
  const setPolicy = useSetAtom(setApprovalPolicyAtom);
  const initialEnabled = org?.approvalPolicy !== null && org?.approvalPolicy !== undefined;
  const initialThreshold =
    org?.approvalPolicy?.requiredApprovals ?? DEFAULT_REQUIRED_APPROVALS;

  const [enabled, setEnabled] = useState<boolean>(initialEnabled);
  const [threshold, setThreshold] = useState<number>(initialThreshold);
  const [saving, setSaving] = useState(false);

  if (!org) {
    return <Text c="dimmed">No active organization</Text>;
  }

  const dirty =
    enabled !== initialEnabled
    || (enabled && threshold !== initialThreshold);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await setPolicy(enabled ? threshold : null);
      notifications.show({
        color: "green",
        title: "Policy saved",
        message: updated.approvalPolicy
          ? `Production promotions now require ${updated.approvalPolicy.requiredApprovals} approvals`
          : "Production promotions are now direct",
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to save policy";
      notifications.show({ color: "red", title: "Error", message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper withBorder p="lg">
      <Stack>
        <div>
          <Text fw={600}>Production approval gate</Text>
          <Text size="sm" c="dimmed">
            When enabled, promoting a version to <b>production</b> goes through
            an approval request. The request auto-promotes once the threshold
            of distinct approvers is reached. Other transitions (draft →
            development → staging) remain direct.
          </Text>
        </div>

        <Switch
          label="Require approvals before production"
          checked={enabled}
          onChange={(e) => setEnabled(e.currentTarget.checked)}
        />

        <NumberInput
          label="Required approvers"
          description="Distinct users who must vote 'approve' before the version auto-promotes. Bounded 1..10."
          min={1}
          max={10}
          value={threshold}
          onChange={(v) =>
            setThreshold(typeof v === "number" ? v : DEFAULT_REQUIRED_APPROVALS)
          }
          disabled={!enabled}
          w={240}
        />

        <Group justify="flex-end">
          <Button
            disabled={!dirty}
            loading={saving}
            onClick={() => void handleSave()}
          >
            Save policy
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
};
