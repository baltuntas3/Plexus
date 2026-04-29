import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type {
  AuthResponse,
  AuthTokens,
  LoginRequest,
  OrganizationDto,
  RegisterRequest,
  UserDto,
} from "@plexus/shared-types";
import { apiRequest } from "../lib/api-client.js";

export const tokensAtom = atomWithStorage<AuthTokens | null>("plexus.tokens", null);
export const userAtom = atomWithStorage<UserDto | null>("plexus.user", null);
// Active organization for the current session. Stored alongside the token
// so the org name can be rendered in the header without an extra round
// trip. Refreshed by login/register; org switching (Faz 1B-C) will issue
// a new token and replace this atom.
export const currentOrganizationAtom = atomWithStorage<OrganizationDto | null>(
  "plexus.currentOrganization",
  null,
);

export const isAuthenticatedAtom = atom(
  (get) =>
    get(tokensAtom) !== null &&
    get(userAtom) !== null &&
    get(currentOrganizationAtom) !== null,
);

export const loginAtom = atom(null, async (_get, set, input: LoginRequest) => {
  const res = await apiRequest<AuthResponse>("/auth/login", {
    method: "POST",
    body: input,
  });
  set(tokensAtom, res.tokens);
  set(userAtom, res.user);
  set(currentOrganizationAtom, res.organization);
  return res.user;
});

export const registerAtom = atom(
  null,
  async (_get, set, input: RegisterRequest) => {
    const res = await apiRequest<AuthResponse>("/auth/register", {
      method: "POST",
      body: input,
    });
    set(tokensAtom, res.tokens);
    set(userAtom, res.user);
    set(currentOrganizationAtom, res.organization);
    return res.user;
  },
);

export const logoutAtom = atom(null, (_get, set) => {
  set(tokensAtom, null);
  set(userAtom, null);
  set(currentOrganizationAtom, null);
});
