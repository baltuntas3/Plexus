import { Organization, slugifyOrganizationName } from "../organization.js";
import {
  OrganizationMember,
} from "../organization-member.js";

describe("Organization aggregate", () => {
  it("creates with normalized slug and trimmed name", () => {
    const org = Organization.create({
      organizationId: "o1",
      name: "  Acme Co  ",
      slug: "ACME",
      ownerId: "u1",
    });
    expect(org.name).toBe("Acme Co");
    expect(org.slug).toBe("acme");
    expect(org.ownerId).toBe("u1");
    expect(org.revision).toBe(0);
  });

  it("rejects invalid slug", () => {
    expect(() =>
      Organization.create({
        organizationId: "o1",
        name: "x",
        slug: "has space",
        ownerId: "u1",
      }),
    ).toThrow(/slug/);
  });

  it("snapshot+markPersisted advances revision", () => {
    const org = Organization.create({
      organizationId: "o1",
      name: "x",
      slug: "x-org",
      ownerId: "u1",
    });
    const snap = org.toSnapshot();
    expect(snap.expectedRevision).toBe(0);
    expect(snap.primitives.revision).toBe(1);
    expect(org.revision).toBe(0);
    org.markPersisted();
    expect(org.revision).toBe(1);
  });

  it("starts with no approval policy", () => {
    const org = Organization.create({
      organizationId: "o1",
      name: "x",
      slug: "x-org",
      ownerId: "u1",
    });
    expect(org.approvalPolicy).toBeNull();
  });

  it("setApprovalPolicy installs and clears the gate", () => {
    const org = Organization.create({
      organizationId: "o1",
      name: "x",
      slug: "x-org",
      ownerId: "u1",
    });
    org.setApprovalPolicy({ requiredApprovals: 2 });
    expect(org.approvalPolicy?.requiredApprovals).toBe(2);
    org.setApprovalPolicy(null);
    expect(org.approvalPolicy).toBeNull();
  });

  it("setApprovalPolicy is a no-op when the value is unchanged", () => {
    const org = Organization.create({
      organizationId: "o1",
      name: "x",
      slug: "x-org",
      ownerId: "u1",
    });
    org.setApprovalPolicy({ requiredApprovals: 3 });
    const before = org.updatedAt;
    org.setApprovalPolicy({ requiredApprovals: 3 });
    expect(org.updatedAt).toBe(before);
  });

  it("setApprovalPolicy rejects out-of-range or non-integer thresholds", () => {
    const org = Organization.create({
      organizationId: "o1",
      name: "x",
      slug: "x-org",
      ownerId: "u1",
    });
    expect(() => org.setApprovalPolicy({ requiredApprovals: 0 })).toThrow(/between/);
    expect(() => org.setApprovalPolicy({ requiredApprovals: 11 })).toThrow(/between/);
    expect(() => org.setApprovalPolicy({ requiredApprovals: 2.5 })).toThrow(/integer/);
  });
});

describe("slugifyOrganizationName", () => {
  it("strips accents and lowercases", () => {
    expect(slugifyOrganizationName("Açme Çö")).toBe("acme-co");
    expect(slugifyOrganizationName("Hello World!")).toBe("hello-world");
  });

  it("falls back to 'org' when nothing remains", () => {
    expect(slugifyOrganizationName("@@@")).toBe("org");
  });
});

describe("OrganizationMember aggregate", () => {
  const make = (role: "admin" | "editor" | "approver" | "viewer" | "owner") =>
    OrganizationMember.create({
      id: "m1",
      organizationId: "o1",
      userId: "u1",
      role,
    });

  it("changeRole rejects assigning or removing owner", () => {
    const owner = make("owner");
    expect(() => owner.changeRole("admin")).toThrow(/owner/i);
    const admin = make("admin");
    expect(() => admin.changeRole("owner")).toThrow(/owner/i);
  });

  it("changeRole moves between non-owner roles", () => {
    const m = make("editor");
    m.changeRole("approver");
    expect(m.role).toBe("approver");
  });
});
