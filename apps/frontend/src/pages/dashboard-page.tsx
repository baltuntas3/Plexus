import { Stack, Text, Title } from "@mantine/core";
import { useAtomValue } from "jotai";
import { userAtom } from "../atoms/auth.atoms.js";

export const DashboardPage = () => {
  const user = useAtomValue(userAtom);
  return (
    <Stack>
      <Title order={2}>Dashboard</Title>
      <Text>Welcome{user ? `, ${user.name}` : ""}.</Text>
    </Stack>
  );
};
