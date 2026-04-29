import type { Request, Response } from "express";
import { OrganizationMember } from "../../../../domain/entities/organization-member.js";
import { InMemoryOrganizationMemberRepository } from "../../../../__tests__/fakes/in-memory-organization-member-repository.js";
import { createRequirePermission } from "../require-permission.js";

const buildReq = (overrides: Partial<Request>): Request =>
  ({
    userId: undefined,
    organizationId: undefined,
    organizationRole: undefined,
    ...overrides,
  } as Request);

const collectError = (): {
  next: (err?: unknown) => void;
  errors: unknown[];
} => {
  const errors: unknown[] = [];
  return {
    next: (err?: unknown) => {
      if (err !== undefined) errors.push(err);
    },
    errors,
  };
};

describe("requirePermission middleware", () => {
  let memberships: InMemoryOrganizationMemberRepository;

  beforeEach(async () => {
    memberships = new InMemoryOrganizationMemberRepository();
    const member = OrganizationMember.create({
      id: "m-1",
      organizationId: "org-1",
      userId: "u-1",
      role: "editor",
    });
    await memberships.save(member);
  });

  const res = {} as Response;

  it("rejects unauthenticated requests", async () => {
    const middleware = createRequirePermission(memberships)("prompt:read");
    const { next, errors } = collectError();
    await middleware(buildReq({}), res, next);
    expect(errors[0]).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects requests where the user is not a member of the active org", async () => {
    const middleware = createRequirePermission(memberships)("prompt:read");
    const { next, errors } = collectError();
    await middleware(
      buildReq({ userId: "u-1", organizationId: "other-org" }),
      res,
      next,
    );
    expect(errors[0]).toMatchObject({ code: "ORGANIZATION_MEMBERSHIP_REQUIRED" });
  });

  it("rejects requests when the role lacks the permission", async () => {
    // Editor cannot approve production versions.
    const middleware = createRequirePermission(memberships)("version:approve");
    const { next, errors } = collectError();
    await middleware(
      buildReq({ userId: "u-1", organizationId: "org-1" }),
      res,
      next,
    );
    expect(errors[0]).toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows requests when the role grants the permission and stamps the role on req", async () => {
    const middleware = createRequirePermission(memberships)("prompt:create");
    const req = buildReq({ userId: "u-1", organizationId: "org-1" });
    const { next, errors } = collectError();
    await middleware(req, res, next);
    expect(errors).toEqual([]);
    expect(req.organizationRole).toBe("editor");
  });

  it("re-resolves membership on every call (defense-in-depth)", async () => {
    // A token issued before the user was removed should not pass once the
    // membership row is gone — the middleware does not trust the JWT
    // claim alone.
    const middleware = createRequirePermission(memberships)("prompt:read");
    const req = buildReq({ userId: "u-1", organizationId: "org-1" });

    {
      const { next, errors } = collectError();
      await middleware(req, res, next);
      expect(errors).toEqual([]);
    }

    const member = await memberships.findByOrganizationAndUser("org-1", "u-1");
    await memberships.remove(member!.id);

    {
      const { next, errors } = collectError();
      await middleware(req, res, next);
      expect(errors[0]).toMatchObject({ code: "ORGANIZATION_MEMBERSHIP_REQUIRED" });
    }
  });
});
