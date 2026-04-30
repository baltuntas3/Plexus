import { atom, type Getter } from "jotai";
import type {
  AssignableOrganizationRole,
  OrganizationDto,
  OrganizationInvitationDto,
  OrganizationMemberDto,
  OrganizationMembershipEventDto,
  OrganizationRole,
  VersionApprovalRequestDto,
} from "@plexus/shared-types";
import { apiRequest } from "../lib/api-client.js";
import { currentOrganizationAtom, tokensAtom, userAtom } from "./auth.atoms.js";

// Refresh counters: any mutation bumps the matching counter, the read
// atom re-fetches. Standard Jotai server-state pattern from CLAUDE.md.
export const membersRefreshAtom = atom(0);
export const invitationsRefreshAtom = atom(0);
export const eventsRefreshAtom = atom(0);
export const approvalRequestsRefreshAtom = atom(0);

// Session guard for mutation atoms that act on the active organization.
// Centralized so the auth + active-org invariants are asserted once
// instead of repeated three-line preludes per atom.
const requireSession = (get: Getter): { token: string; orgId: string } => {
  const tokens = get(tokensAtom);
  const org = get(currentOrganizationAtom);
  if (!tokens) throw new Error("Not authenticated");
  if (!org) throw new Error("No active organization");
  return { token: tokens.accessToken, orgId: org.id };
};

// Token-only variant for endpoints that don't need an active org
// (invitation redemption — caller is not yet a member of the target).
const requireToken = (get: Getter): string => {
  const tokens = get(tokensAtom);
  if (!tokens) throw new Error("Not authenticated");
  return tokens.accessToken;
};

// Non-throwing session getter for read atoms. Read atoms are evaluated
// eagerly on render; before login or during initial bootstrap there is
// no session, and the atom should resolve to an empty list rather than
// throw and surface a Suspense error boundary.
const trySession = (get: Getter): { token: string; orgId: string } | null => {
  const tokens = get(tokensAtom);
  const org = get(currentOrganizationAtom);
  if (!tokens || !org) return null;
  return { token: tokens.accessToken, orgId: org.id };
};

export const membersAtom = atom(async (get) => {
  get(membersRefreshAtom);
  const session = trySession(get);
  if (!session) return [];
  const res = await apiRequest<{ members: OrganizationMemberDto[] }>(
    `/organizations/${session.orgId}/members`,
    { token: session.token },
  );
  return res.members;
});

// Resolves the active user's role in the active organization by joining
// `membersAtom` with `userAtom`. Used by UI permission gating so buttons
// disable themselves before the backend's defense-in-depth `requirePermission`
// middleware would have to reject the request. Returns null when the
// session has no user or the membership row hasn't loaded yet.
export const currentRoleAtom = atom(async (get): Promise<OrganizationRole | null> => {
  const user = get(userAtom);
  if (!user) return null;
  const members = await get(membersAtom);
  const own = members.find((m) => m.userId === user.id);
  return own?.role ?? null;
});

export const invitationsAtom = atom(async (get) => {
  get(invitationsRefreshAtom);
  const session = trySession(get);
  if (!session) return [];
  const res = await apiRequest<{ invitations: OrganizationInvitationDto[] }>(
    `/organizations/${session.orgId}/invitations`,
    { token: session.token },
  );
  return res.invitations;
});

export const eventsAtom = atom(async (get) => {
  get(eventsRefreshAtom);
  const session = trySession(get);
  if (!session) return [];
  const res = await apiRequest<{ events: OrganizationMembershipEventDto[] }>(
    `/organizations/${session.orgId}/events`,
    { token: session.token },
  );
  return res.events;
});

// Org-wide pending approval inbox. Approvers and admins land on this
// list to vote; editors land here to track their own outstanding
// requests. The endpoint filters out resolved rows server-side.
export const pendingApprovalRequestsAtom = atom(async (get) => {
  get(approvalRequestsRefreshAtom);
  const session = trySession(get);
  if (!session) return [];
  const res = await apiRequest<{ requests: VersionApprovalRequestDto[] }>(
    `/organizations/${session.orgId}/approval-requests`,
    { token: session.token },
  );
  return res.requests;
});

// ── Mutations ────────────────────────────────────────────────────────────────

export interface InviteMemberInput {
  email: string;
  role: AssignableOrganizationRole;
}

export interface InviteMemberOutput {
  invitation: OrganizationInvitationDto;
  // Plaintext token returned exactly once. UI shows it as a copy-link
  // dialog; subsequent invitation listings never include it.
  token: string;
}

export const inviteMemberAtom = atom(
  null,
  async (get, set, input: InviteMemberInput): Promise<InviteMemberOutput> => {
    const { token, orgId } = requireSession(get);
    const res = await apiRequest<InviteMemberOutput>(
      `/organizations/${orgId}/invitations`,
      { method: "POST", body: input, token },
    );
    set(invitationsRefreshAtom, (n) => n + 1);
    set(eventsRefreshAtom, (n) => n + 1);
    return res;
  },
);

export const cancelInvitationAtom = atom(
  null,
  async (get, set, invitationId: string) => {
    const { token, orgId } = requireSession(get);
    await apiRequest<void>(
      `/organizations/${orgId}/invitations/${invitationId}`,
      { method: "DELETE", token },
    );
    set(invitationsRefreshAtom, (n) => n + 1);
    set(eventsRefreshAtom, (n) => n + 1);
  },
);

export const updateMemberRoleAtom = atom(
  null,
  async (
    get,
    set,
    params: { memberId: string; role: AssignableOrganizationRole },
  ) => {
    const { token, orgId } = requireSession(get);
    await apiRequest<void>(`/organizations/${orgId}/members/${params.memberId}`, {
      method: "PATCH",
      body: { role: params.role },
      token,
    });
    set(membersRefreshAtom, (n) => n + 1);
    set(eventsRefreshAtom, (n) => n + 1);
  },
);

export const removeMemberAtom = atom(
  null,
  async (get, set, memberId: string) => {
    const { token, orgId } = requireSession(get);
    await apiRequest<void>(`/organizations/${orgId}/members/${memberId}`, {
      method: "DELETE",
      token,
    });
    set(membersRefreshAtom, (n) => n + 1);
    set(eventsRefreshAtom, (n) => n + 1);
  },
);

export const transferOwnershipAtom = atom(
  null,
  async (get, set, newOwnerUserId: string) => {
    const { token, orgId } = requireSession(get);
    await apiRequest<void>(`/organizations/${orgId}/ownership/transfer`, {
      method: "POST",
      body: { newOwnerUserId },
      token,
    });
    set(membersRefreshAtom, (n) => n + 1);
    set(eventsRefreshAtom, (n) => n + 1);
  },
);

// Redemption — caller is logged in but may not yet be a member of the
// target org. Uses the flat `/invitations/accept` route so the URL
// doesn't leak the target org id, and `requireToken` instead of
// `requireSession` because the active-org invariant is intentionally
// not asserted here.
export const acceptInvitationAtom = atom(
  null,
  async (get, _set, redemptionToken: string): Promise<{ organizationId: string }> => {
    const token = requireToken(get);
    return apiRequest<{ organizationId: string }>("/invitations/accept", {
      method: "POST",
      body: { token: redemptionToken },
      token,
    });
  },
);

// ── Approval workflow mutations ───────────────────────────────────────────────

// Set or clear the org's `→ production` approval gate. The backend
// returns the full updated org DTO; we mirror it into
// `currentOrganizationAtom` so subsequent reads (header badge, the
// "production needs approval?" check on the prompt detail page) see the
// new state without a refetch.
export const setApprovalPolicyAtom = atom(
  null,
  async (
    get,
    set,
    requiredApprovals: number | null,
  ): Promise<OrganizationDto> => {
    const { token, orgId } = requireSession(get);
    const res = await apiRequest<{ organization: OrganizationDto }>(
      `/organizations/${orgId}/approval-policy`,
      { method: "PUT", body: { requiredApprovals }, token },
    );
    set(currentOrganizationAtom, res.organization);
    return res.organization;
  },
);

export const requestVersionApprovalAtom = atom(
  null,
  async (
    get,
    set,
    params: { promptId: string; version: string },
  ): Promise<VersionApprovalRequestDto> => {
    const { token, orgId } = requireSession(get);
    const res = await apiRequest<{ request: VersionApprovalRequestDto }>(
      `/organizations/${orgId}/prompts/${params.promptId}/versions/${params.version}/approval-requests`,
      { method: "POST", token },
    );
    set(approvalRequestsRefreshAtom, (n) => n + 1);
    return res.request;
  },
);

// Each vote/cancel mutation bumps the same refresh counter — the inbox
// reflects the new vote set on the next render without page reload.
const voteOnApprovalRequest = (action: "approve" | "reject" | "cancel") =>
  atom(
    null,
    async (
      get,
      set,
      requestId: string,
    ): Promise<VersionApprovalRequestDto> => {
      const { token, orgId } = requireSession(get);
      const res = await apiRequest<{ request: VersionApprovalRequestDto }>(
        `/organizations/${orgId}/approval-requests/${requestId}/${action}`,
        { method: "POST", token },
      );
      set(approvalRequestsRefreshAtom, (n) => n + 1);
      return res.request;
    },
  );

export const approveVersionRequestAtom = voteOnApprovalRequest("approve");
export const rejectVersionRequestAtom = voteOnApprovalRequest("reject");
export const cancelVersionRequestAtom = voteOnApprovalRequest("cancel");
