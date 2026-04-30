import { AppShell, Badge, Burger, Group, NavLink, Text, Button } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAtomValue, useSetAtom } from "jotai";
import {
  currentOrganizationAtom,
  logoutAtom,
  userAtom,
} from "../atoms/auth.atoms.js";

export const AppLayout = () => {
  const [opened, { toggle }] = useDisclosure();
  const user = useAtomValue(userAtom);
  const organization = useAtomValue(currentOrganizationAtom);
  const logout = useSetAtom(logoutAtom);
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 240, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Text fw={700}>Plexus</Text>
            {organization && (
              <Badge variant="light" color="blue" size="sm">
                {organization.name}
              </Badge>
            )}
          </Group>
          <Group>
            {user && <Text size="sm">{user.email}</Text>}
            <Button variant="subtle" size="xs" onClick={handleLogout}>
              Logout
            </Button>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="md">
        <NavLink
          label="Dashboard"
          active={location.pathname === "/"}
          onClick={() => navigate("/")}
        />
        <NavLink
          label="Prompts"
          active={location.pathname.startsWith("/prompts")}
          onClick={() => navigate("/prompts")}
        />
        <NavLink
          label="Organization"
          active={location.pathname.startsWith("/organization")}
          onClick={() => navigate("/organization/settings")}
        />
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
};
