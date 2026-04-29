import type { OrganizationRole } from "@plexus/shared-types";

// Single source of truth for the role → permission mapping. Authorization
// middleware reads this map; route handlers declare a single permission
// they require (`requirePermission("prompt:promote")`) and the middleware
// resolves it against the caller's role.
//
// `if role === "admin"` style checks in business code are explicitly
// rejected — every authorization decision routes through this map so a
// new role or permission ships in one file edit, not as a scattered
// switch-zincir refactor across use cases.

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
  // Prompt + version writes
  "prompt:create",
  "prompt:edit",
  "prompt:promote",
  "version:create",
  "version:edit",
  "version:approve",
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
// the role below it has, then layers on its own privileges. This keeps
// the matrix easy to audit (no role can silently lose a permission a
// lower role still has) and matches the role-hierarchy users expect.

const VIEWER_PERMISSIONS: readonly Permission[] = [
  "prompt:read",
  "version:read",
  "benchmark:read",
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
  "version:create",
  "version:edit",
  "benchmark:create",
  "benchmark:edit",
];

// Admins inherit editor capabilities and add organization administration
// (members + settings + policy) plus the ability to vote on production
// approval requests. They cannot delete the org or transfer ownership.
const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...EDITOR_PERMISSIONS,
  "version:approve",
  "org:settings:edit",
  "policy:edit",
  "member:invite",
  "member:role:update",
  "member:remove",
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
