import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Center,
  Loader,
  Paper,
  Stack,
  Title,
} from "@mantine/core";
import { useAtomValue, useSetAtom } from "jotai";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import {
  isAuthenticatedAtom,
  logoutAtom,
} from "../atoms/auth.atoms.js";
import { acceptInvitationAtom } from "../atoms/organizations.atoms.js";
import { ApiError } from "../lib/api-client.js";

// Redemption flow:
//   1. User clicks the link from their email → arrives at this page.
//   2. If not logged in: kick to /login (a return-to query param is
//      preserved so login bounces back here after auth).
//   3. POST /invitations/accept with the token. Backend matches the
//      caller's JWT email against the invitation's email; mismatch =>
//      EMAIL_MISMATCH error rendered inline.
//   4. On success, the user is now a member of the target org. They
//      need a fresh token whose claim points at that org — easiest
//      flow today is to log out and log back in. Org switcher (Faz
//      1B-C scope) will replace this with an in-place token swap.
export const AcceptInvitationPage = () => {
  const [params] = useSearchParams();
  const token = params.get("token");
  const isAuthenticated = useAtomValue(isAuthenticatedAtom);
  const accept = useSetAtom(acceptInvitationAtom);
  const logout = useSetAtom(logoutAtom);
  const navigate = useNavigate();

  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "success"; organizationId: string }
  >({ kind: "idle" });

  useEffect(() => {
    if (!token || !isAuthenticated || state.kind !== "idle") return;
    setState({ kind: "loading" });
    accept(token)
      .then((res) => setState({ kind: "success", organizationId: res.organizationId }))
      .catch((err) => {
        const message =
          err instanceof ApiError
            ? err.message
            : "Could not redeem this invitation";
        setState({ kind: "error", message });
      });
  }, [token, isAuthenticated, accept, state.kind]);

  if (!isAuthenticated) {
    const target = `/invitations/accept${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(target)}`} replace />;
  }

  if (!token) {
    return (
      <Center h="80vh">
        <Paper p="xl" withBorder>
          <Alert color="red">Missing invitation token in the URL.</Alert>
        </Paper>
      </Center>
    );
  }

  return (
    <Center h="80vh">
      <Paper p="xl" withBorder w={460}>
        <Stack>
          <Title order={3} ta="center">
            Accept invitation
          </Title>
          {state.kind === "loading" || state.kind === "idle" ? (
            <Center py="lg">
              <Loader />
            </Center>
          ) : state.kind === "error" ? (
            <>
              <Alert color="red">{state.message}</Alert>
              <Button onClick={() => navigate("/")} variant="subtle" fullWidth>
                Back to dashboard
              </Button>
            </>
          ) : (
            <>
              <Alert color="green">
                You've joined the organization. Sign out and back in to switch
                your active session to the new org.
              </Alert>
              <Button
                onClick={() => {
                  logout();
                  navigate("/login", { replace: true });
                }}
                fullWidth
              >
                Sign out and continue
              </Button>
            </>
          )}
        </Stack>
      </Paper>
    </Center>
  );
};
