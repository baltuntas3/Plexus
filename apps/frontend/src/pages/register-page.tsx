import { useState } from "react";
import {
  Anchor,
  Button,
  Center,
  Group,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { useAtomValue, useSetAtom } from "jotai";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { isAuthenticatedAtom, registerAtom } from "../atoms/auth.atoms.js";
import { ApiError } from "../lib/api-client.js";

export const RegisterPage = () => {
  const isAuthenticated = useAtomValue(isAuthenticatedAtom);
  const register = useSetAtom(registerAtom);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const form = useForm({
    initialValues: {
      name: "",
      email: "",
      password: "",
      organizationName: "",
    },
    validate: {
      name: (v) => (v.trim().length >= 1 ? null : "Name is required"),
      email: (v) => (/^\S+@\S+\.\S+$/.test(v) ? null : "Invalid email"),
      password: (v) =>
        v.length >= 8 ? null : "Password must be at least 8 characters",
      organizationName: (v) =>
        v.trim().length >= 1 ? null : "Organization name is required",
    },
  });

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (values: typeof form.values) => {
    setLoading(true);
    try {
      await register(values);
      navigate("/", { replace: true });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Registration failed";
      notifications.show({ color: "red", title: "Error", message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Center h="100vh">
      <Paper p="xl" shadow="md" radius="md" w={420}>
        <Title order={3} mb="lg" ta="center">
          Create your Plexus organization
        </Title>
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack>
            <TextInput
              label="Your name"
              placeholder="Jane Doe"
              {...form.getInputProps("name")}
            />
            <TextInput
              label="Email"
              placeholder="you@company.com"
              {...form.getInputProps("email")}
            />
            <PasswordInput
              label="Password"
              description="At least 8 characters"
              {...form.getInputProps("password")}
            />
            <TextInput
              label="Organization name"
              description="A URL-friendly slug is generated from this; collisions get a numeric suffix."
              placeholder="Acme"
              {...form.getInputProps("organizationName")}
            />
            <Button type="submit" loading={loading} fullWidth>
              Create account
            </Button>
            <Group justify="center" gap={4}>
              <Text size="sm" c="dimmed">
                Already have an account?
              </Text>
              <Anchor component={Link} to="/login" size="sm">
                Sign in
              </Anchor>
            </Group>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
};
