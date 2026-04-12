import { useState } from "react";
import { Button, Center, Paper, PasswordInput, Stack, TextInput, Title } from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { useSetAtom } from "jotai";
import { Navigate, useNavigate } from "react-router-dom";
import { useAtomValue } from "jotai";
import { isAuthenticatedAtom, loginAtom } from "../atoms/auth.atoms.js";
import { ApiError } from "../lib/api-client.js";

export const LoginPage = () => {
  const isAuthenticated = useAtomValue(isAuthenticatedAtom);
  const login = useSetAtom(loginAtom);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const form = useForm({
    initialValues: { email: "", password: "" },
    validate: {
      email: (v) => (/^\S+@\S+\.\S+$/.test(v) ? null : "Invalid email"),
      password: (v) => (v.length >= 1 ? null : "Password required"),
    },
  });

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (values: typeof form.values) => {
    setLoading(true);
    try {
      await login(values);
      navigate("/", { replace: true });
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
            <TextInput label="Email" placeholder="you@example.com" {...form.getInputProps("email")} />
            <PasswordInput label="Password" {...form.getInputProps("password")} />
            <Button type="submit" loading={loading} fullWidth>
              Sign in
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
};
