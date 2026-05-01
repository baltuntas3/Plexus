import {
  AppShell,
  Avatar,
  Badge,
  Group,
  Menu,
  Text,
  UnstyledButton,
} from "@mantine/core";
import {
  IconBuildingSkyscraper,
  IconChevronDown,
  IconLogout,
} from "@tabler/icons-react";
import { Outlet, useNavigate } from "react-router-dom";
import { useAtomValue, useSetAtom } from "jotai";
import {
  currentOrganizationAtom,
  logoutAtom,
  userAtom,
} from "../atoms/auth.atoms.js";

const initialsOf = (name?: string | null, email?: string | null) => {
  const source = name?.trim() || email?.trim() || "";
  if (!source) return "?";
  const parts = source.split(/\s+/);
  if (parts.length === 1) return source.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
};

export const AppLayout = () => {
  const user = useAtomValue(userAtom);
  const organization = useAtomValue(currentOrganizationAtom);
  const logout = useSetAtom(logoutAtom);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <UnstyledButton onClick={() => navigate("/prompts")}>
              <Text fw={700}>Plexus</Text>
            </UnstyledButton>
            {organization && (
              <Badge variant="light" color="blue" size="sm">
                {organization.name}
              </Badge>
            )}
          </Group>
          {user && (
            <Menu shadow="md" width={220} position="bottom-end">
              <Menu.Target>
                <UnstyledButton>
                  <Group gap="xs">
                    <Avatar size={30} radius="xl" color="blue">
                      {initialsOf(user.name, user.email)}
                    </Avatar>
                    <div style={{ lineHeight: 1.1 }}>
                      <Text size="sm" fw={500}>
                        {user.name || user.email}
                      </Text>
                      {user.name && (
                        <Text size="xs" c="dimmed">
                          {user.email}
                        </Text>
                      )}
                    </div>
                    <IconChevronDown size={14} />
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Account</Menu.Label>
                <Menu.Item
                  leftSection={<IconBuildingSkyscraper size={16} />}
                  onClick={() => navigate("/organization/settings")}
                >
                  Organization settings
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  color="red"
                  leftSection={<IconLogout size={16} />}
                  onClick={handleLogout}
                >
                  Logout
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
      </AppShell.Header>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
};
