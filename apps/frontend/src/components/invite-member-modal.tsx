import { useState } from "react";
import {
  Alert,
  Button,
  CopyButton,
  Group,
  Modal,
  PasswordInput,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { useSetAtom } from "jotai";
import {
  ASSIGNABLE_ROLES,
  type AssignableOrganizationRole,
} from "@plexus/shared-types";
import { inviteMemberAtom } from "../atoms/organizations.atoms.js";
import { ApiError } from "../lib/api-client.js";

interface InviteMemberModalProps {
  opened: boolean;
  onClose: () => void;
}

// Two-stage modal: form → issued state. Once a token is issued the form
// is replaced by a "copy this link" panel because the plaintext token
// is shown exactly once.
export const InviteMemberModal = ({ opened, onClose }: InviteMemberModalProps) => {
  const invite = useSetAtom(inviteMemberAtom);
  const [loading, setLoading] = useState(false);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [issuedEmail, setIssuedEmail] = useState<string | null>(null);

  const form = useForm({
    initialValues: { email: "", role: "editor" as AssignableOrganizationRole },
    validate: {
      email: (v) => (/^\S+@\S+\.\S+$/.test(v) ? null : "Invalid email"),
    },
  });

  const handleClose = () => {
    form.reset();
    setIssuedToken(null);
    setIssuedEmail(null);
    onClose();
  };

  const handleSubmit = async (values: typeof form.values) => {
    setLoading(true);
    try {
      const res = await invite(values);
      setIssuedToken(res.token);
      setIssuedEmail(values.email);
      notifications.show({
        color: "green",
        title: "Invitation issued",
        message: `Send the link to ${values.email}`,
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to invite";
      notifications.show({ color: "red", title: "Error", message });
    } finally {
      setLoading(false);
    }
  };

  // Frontend renders the redemption URL itself — admin copies the
  // resulting link and forwards it (email integration is out of scope).
  const redemptionLink =
    issuedToken !== null
      ? `${window.location.origin}/invitations/accept?token=${encodeURIComponent(issuedToken)}`
      : null;

  return (
    <Modal opened={opened} onClose={handleClose} title="Invite member" size="md">
      {issuedToken === null ? (
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack>
            <TextInput
              label="Email"
              placeholder="teammate@company.com"
              {...form.getInputProps("email")}
            />
            <Select
              label="Role"
              data={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: r }))}
              {...form.getInputProps("role")}
            />
            <Text size="xs" c="dimmed">
              Owner role is reserved for ownership transfer and cannot be assigned by invitation.
            </Text>
            <Group justify="flex-end">
              <Button variant="subtle" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" loading={loading}>
                Send invitation
              </Button>
            </Group>
          </Stack>
        </form>
      ) : (
        <Stack>
          <Alert color="green" title="Invitation issued">
            Send the link below to <b>{issuedEmail}</b>. The token is shown once
            — the API does not return it again.
          </Alert>
          <PasswordInput
            label="Redemption link"
            value={redemptionLink ?? ""}
            readOnly
            visible
          />
          <Group justify="flex-end">
            <CopyButton value={redemptionLink ?? ""}>
              {({ copied, copy }) => (
                <Button onClick={copy} variant={copied ? "filled" : "light"}>
                  {copied ? "Copied" : "Copy link"}
                </Button>
              )}
            </CopyButton>
            <Button onClick={handleClose}>Done</Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
};
