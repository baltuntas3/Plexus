import { useAtomValue } from "jotai";
import { loadable } from "jotai/utils";
import { roleHasPermission, type Permission } from "@plexus/shared-types";
import { currentRoleAtom } from "../atoms/organizations.atoms.js";

// Module-level wrapper: `currentRoleAtom` never changes identity, so
// the loadable wrapper is allocated once and shared across every
// `usePermission` call instead of re-created per component render.
const loadableCurrentRoleAtom = loadable(currentRoleAtom);

// UI-side mirror of the backend's `requirePermission` middleware. Returns
// false until the role lookup resolves so gated buttons render disabled
// (instead of flashing enabled and rejecting on click). The `loadable`
// wrapper keeps suspension out of the call site — the page renders the
// rest of the UI while the role atom resolves.
export const usePermission = (permission: Permission): boolean => {
  const roleLoadable = useAtomValue(loadableCurrentRoleAtom);
  const role = roleLoadable.state === "hasData" ? roleLoadable.data : null;
  return role !== null && roleHasPermission(role, permission);
};
