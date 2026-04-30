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
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { isAuthenticatedAtom, loginAtom } from "../atoms/auth.atoms.js";
import { ApiError } from "../lib/api-client.js";

export const LoginPage = () => {
  const isAuthenticated = useAtomValue(isAuthenticatedAtom);
  const login = useSetAtom(loginAtom);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [loading, setLoading] = useState(false);

  // Same-origin path only. Open redirect via `?redirect=https://evil`
  // would be a classic phishing vector; the prefix check rejects
  // protocol-relative URLs (`//evil`) and absolute URLs.
  const redirectTarget = (() => {
    const raw = params.get("redirect");
    if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
    return raw;
  })();

  const form = useForm({
    initialValues: { email: "", password: "" },
    validate: {
      email: (v) => (/^\S+@\S+\.\S+$/.test(v) ? null : "Invalid email"),
      password: (v) => (v.length >= 1 ? null : "Password required"),
    },
  });

  if (isAuthenticated) {
    return <Navigate to={redirectTarget} replace />;
  }

  const handleSubmit = async (values: typeof form.values) => {
    setLoading(true);
    try {
      await login(values);
      navigate(redirectTarget, { replace: true });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Login failed";
      notifications.show({ color: "red", title: "Error", message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Center h="100vh">
      <Paper p="xl" shadow="md" radius="md" w={380}>
        <Title order={3} mb="lg" ta="center">
          Plexus Login
        </Title>
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack>
            <TextInput
              label="Email"
              placeholder="you@example.com"
              {...form.getInputProps("email")}
            />
            <PasswordInput label="Password" {...form.getInputProps("password")} />
            <Button type="submit" loading={loading} fullWidth>
              Sign in
            </Button>
            <Group justify="center" gap={4}>
              <Text size="sm" c="dimmed">
                New to Plexus?
              </Text>
              <Anchor component={Link} to="/register" size="sm">
                Create an organization
              </Anchor>
            </Group>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
};
