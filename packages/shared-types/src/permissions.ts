import type { OrganizationRole } from "./organization.js";

// Single source of truth for the role → permission mapping. Backend
// authorization middleware reads this map; frontend UI gating reads the
// same map so disabled-buttons and 403 responses stay in sync. Adding a
// permission or shifting a role's capabilities is a one-file edit here,
// never a scattered switch across feature code (`if role === "admin"` is
// explicitly rejected).
//
// Lives in `@plexus/shared-types` rather than the backend so the frontend
// can `roleHasPermission(currentRole, "prompt:promote")` without duplicating
// the matrix; both consumers stay tied to the same enum.

export const PERMISSIONS = [
  // Organization administration
  "org:settings:edit",
  "org:delete",
  "ownership:transfer",
  "policy:edit",
  // Membership administration
  "member:invite",
  "member:role:update",
  "member:remove",
  // Membership reads — split because "see who's on my team" (viewer+) is
  // a much weaker signal than "see who got invited or removed" (admin+;
  // pending recipients and removal history are admin territory).
  "member:read",
  "invitation:read",
  "audit:read",
  // Prompt + version writes. `version:edit` covers both creating a new
  // version (fork) and editing one — both are the same write capability.
  "prompt:create",
  "prompt:edit",
  "prompt:promote",
  "version:edit",
  "version:approve",
  // Approval workflow administration. Voting + reading the approver
  // inbox flow through `version:approve`; the requester can always
  // cancel their own request (enforced inside the use case). This
  // permission is the *override* — admins cancelling someone else's
  // request out from under them.
  "approval:cancel:any",
  // Benchmark writes
  "benchmark:create",
  "benchmark:edit",
  // Reads (every active role gets these)
  "prompt:read",
  "version:read",
  "benchmark:read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

// Permission sets are layered additively: each role inherits everything
// the role below it has, then layers on its own privileges. Keeps the
// matrix easy to audit (no role can silently lose a permission a lower
// role still has) and matches the role-hierarchy users expect.

const VIEWER_PERMISSIONS: readonly Permission[] = [
  "prompt:read",
  "version:read",
  "benchmark:read",
  "member:read",
];

const APPROVER_PERMISSIONS: readonly Permission[] = [
  ...VIEWER_PERMISSIONS,
  "version:approve",
];

const EDITOR_PERMISSIONS: readonly Permission[] = [
  ...VIEWER_PERMISSIONS,
  "prompt:create",
  "prompt:edit",
  "prompt:promote",
  "version:edit",
  "benchmark:create",
  "benchmark:edit",
];

// Admins inherit editor capabilities and add organisation administration
// (members + settings + policy) plus the ability to vote on production
// approval requests. They cannot delete the org or transfer ownership.
const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...EDITOR_PERMISSIONS,
  "version:approve",
  "approval:cancel:any",
  "org:settings:edit",
  "policy:edit",
  "member:invite",
  "member:role:update",
  "member:remove",
  "invitation:read",
  "audit:read",
];

const OWNER_PERMISSIONS: readonly Permission[] = [
  ...ADMIN_PERMISSIONS,
  "org:delete",
  "ownership:transfer",
];

export const ROLE_PERMISSIONS: Record<OrganizationRole, ReadonlySet<Permission>> = {
  owner: new Set(OWNER_PERMISSIONS),
  admin: new Set(ADMIN_PERMISSIONS),
  editor: new Set(EDITOR_PERMISSIONS),
  approver: new Set(APPROVER_PERMISSIONS),
  viewer: new Set(VIEWER_PERMISSIONS),
};

export const roleHasPermission = (
  role: OrganizationRole,
  permission: Permission,
): boolean => ROLE_PERMISSIONS[role].has(permission);
