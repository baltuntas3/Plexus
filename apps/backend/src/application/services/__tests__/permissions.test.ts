import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  roleHasPermission,
  type Permission,
} from "../permissions.js";

describe("permissions map", () => {
  it("every role grants the read triplet", () => {
    const reads: Permission[] = ["prompt:read", "version:read", "benchmark:read"];
    for (const role of ["owner", "admin", "editor", "approver", "viewer"] as const) {
      for (const perm of reads) {
        expect(roleHasPermission(role, perm)).toBe(true);
      }
    }
  });

  it("viewer cannot create or edit", () => {
    expect(roleHasPermission("viewer", "prompt:create")).toBe(false);
    expect(roleHasPermission("viewer", "version:create")).toBe(false);
    expect(roleHasPermission("viewer", "benchmark:create")).toBe(false);
    expect(roleHasPermission("viewer", "version:approve")).toBe(false);
  });

  it("approver only adds version:approve over viewer", () => {
    expect(roleHasPermission("approver", "version:approve")).toBe(true);
    expect(roleHasPermission("approver", "prompt:create")).toBe(false);
    expect(roleHasPermission("approver", "version:edit")).toBe(false);
  });

  it("editor can create/edit prompts and benchmarks but not approve or admin", () => {
    expect(roleHasPermission("editor", "prompt:create")).toBe(true);
    expect(roleHasPermission("editor", "version:create")).toBe(true);
    expect(roleHasPermission("editor", "version:edit")).toBe(true);
    expect(roleHasPermission("editor", "benchmark:create")).toBe(true);
    expect(roleHasPermission("editor", "prompt:promote")).toBe(true);
    expect(roleHasPermission("editor", "version:approve")).toBe(false);
    expect(roleHasPermission("editor", "member:invite")).toBe(false);
  });

  it("admin gets editor + member admin + policy + approve, but not delete or transfer", () => {
    expect(roleHasPermission("admin", "version:edit")).toBe(true);
    expect(roleHasPermission("admin", "version:approve")).toBe(true);
    expect(roleHasPermission("admin", "member:invite")).toBe(true);
    expect(roleHasPermission("admin", "member:role:update")).toBe(true);
    expect(roleHasPermission("admin", "member:remove")).toBe(true);
    expect(roleHasPermission("admin", "policy:edit")).toBe(true);
    expect(roleHasPermission("admin", "org:settings:edit")).toBe(true);
    expect(roleHasPermission("admin", "org:delete")).toBe(false);
    expect(roleHasPermission("admin", "ownership:transfer")).toBe(false);
  });

  it("owner alone gets delete and ownership transfer", () => {
    expect(roleHasPermission("owner", "org:delete")).toBe(true);
    expect(roleHasPermission("owner", "ownership:transfer")).toBe(true);
  });

  it("role hierarchy is monotonic: each layer is a superset of the lower one", () => {
    const inclusion = (a: ReadonlySet<Permission>, b: ReadonlySet<Permission>) => {
      for (const p of a) if (!b.has(p)) return false;
      return true;
    };
    expect(inclusion(ROLE_PERMISSIONS.viewer, ROLE_PERMISSIONS.approver)).toBe(true);
    expect(inclusion(ROLE_PERMISSIONS.viewer, ROLE_PERMISSIONS.editor)).toBe(true);
    expect(inclusion(ROLE_PERMISSIONS.editor, ROLE_PERMISSIONS.admin)).toBe(true);
    expect(inclusion(ROLE_PERMISSIONS.admin, ROLE_PERMISSIONS.owner)).toBe(true);
  });

  it("PERMISSIONS list contains every permission referenced in ROLE_PERMISSIONS", () => {
    const declared = new Set(PERMISSIONS);
    for (const role of Object.values(ROLE_PERMISSIONS)) {
      for (const perm of role) {
        expect(declared.has(perm)).toBe(true);
      }
    }
  });
});
