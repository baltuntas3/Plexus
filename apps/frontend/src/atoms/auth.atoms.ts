import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { AuthResponse, AuthTokens, LoginRequest, UserDto } from "@plexus/shared-types";
import { apiRequest } from "../lib/api-client.js";

export const tokensAtom = atomWithStorage<AuthTokens | null>("plexus.tokens", null);
export const userAtom = atomWithStorage<UserDto | null>("plexus.user", null);

export const isAuthenticatedAtom = atom((get) => get(tokensAtom) !== null && get(userAtom) !== null);

export const loginAtom = atom(null, async (_get, set, input: LoginRequest) => {
  const res = await apiRequest<AuthResponse>("/auth/login", { method: "POST", body: input });
  set(tokensAtom, res.tokens);
  set(userAtom, res.user);
  return res.user;
});

export const logoutAtom = atom(null, (_get, set) => {
  set(tokensAtom, null);
  set(userAtom, null);
});
