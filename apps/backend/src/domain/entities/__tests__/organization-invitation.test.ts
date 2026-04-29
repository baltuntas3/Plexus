import { OrganizationInvitation } from "../organization-invitation.js";

const baseParams = (overrides: Partial<Parameters<typeof OrganizationInvitation.create>[0]> = {}) => {
  const createdAt = overrides.createdAt ?? new Date("2026-01-01T00:00:00Z");
  return {
    id: "inv-1",
    organizationId: "org-1",
    email: "  Alice@Example.COM ",
    role: "editor" as const,
    invitedBy: "u-admin",
    tokenHash: "hash-abc",
    expiresAt: new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000),
    createdAt,
    ...overrides,
  };
};

describe("OrganizationInvitation aggregate", () => {
  it("normalizes email and starts in pending status", () => {
    const inv = OrganizationInvitation.create(baseParams());
    expect(inv.email).toBe("alice@example.com");
    expect(inv.status).toBe("pending");
    expect(inv.resolvedAt).toBeNull();
    expect(inv.revision).toBe(0);
  });

  it("rejects role=owner (reserved for ownership transfer)", () => {
    expect(() =>
      OrganizationInvitation.create(baseParams({ role: "owner" })),
    ).toThrow(/owner role is reserved/);
  });

  it("rejects expiresAt that is not after createdAt", () => {
    const t = new Date("2026-01-01T00:00:00Z");
    expect(() =>
      OrganizationInvitation.create(
        baseParams({ createdAt: t, expiresAt: t }),
      ),
    ).toThrow(/after createdAt/);
  });

  it("rejects malformed email", () => {
    expect(() =>
      OrganizationInvitation.create(baseParams({ email: "not-an-email" })),
    ).toThrow(/Invalid invitation email/);
  });

  describe("redemption state machine", () => {
    const before = new Date("2026-01-05T00:00:00Z");
    const past = new Date("2026-02-01T00:00:00Z");

    it("accepts when pending and not expired", () => {
      const inv = OrganizationInvitation.create(baseParams());
      inv.accept(before);
      expect(inv.status).toBe("accepted");
      expect(inv.resolvedAt).toEqual(before);
    });

    it("refuses to accept after expiresAt", () => {
      const inv = OrganizationInvitation.create(baseParams());
      expect(() => inv.accept(past)).toThrow(
        expect.objectContaining({ code: "ORGANIZATION_INVITATION_EXPIRED" }),
      );
    });

    it("refuses second-acceptance / acceptance-after-cancel", () => {
      const inv = OrganizationInvitation.create(baseParams());
      inv.accept(before);
      expect(() => inv.accept(before)).toThrow(
        expect.objectContaining({ code: "ORGANIZATION_INVITATION_NOT_ACTIVE" }),
      );
    });

    it("cancels only when pending", () => {
      const inv = OrganizationInvitation.create(baseParams());
      inv.cancel(before);
      expect(inv.status).toBe("cancelled");
      expect(() => inv.cancel(before)).toThrow(
        expect.objectContaining({ code: "ORGANIZATION_INVITATION_NOT_ACTIVE" }),
      );
    });

    it("markExpired flips pending → expired and is idempotent", () => {
      const inv = OrganizationInvitation.create(baseParams());
      inv.markExpired(past);
      expect(inv.status).toBe("expired");
      // Idempotent — second call no-op.
      inv.markExpired(past);
      expect(inv.status).toBe("expired");
    });

    it("isExpiredAt is purely time-based and ignores status", () => {
      const inv = OrganizationInvitation.create(baseParams());
      expect(inv.isExpiredAt(before)).toBe(false);
      expect(inv.isExpiredAt(past)).toBe(true);
    });
  });

  it("snapshot/markPersisted advances revision", () => {
    const inv = OrganizationInvitation.create(baseParams());
    const snap = inv.toSnapshot();
    expect(snap.expectedRevision).toBe(0);
    expect(snap.primitives.revision).toBe(1);
    expect(inv.revision).toBe(0);
    inv.markPersisted();
    expect(inv.revision).toBe(1);
  });
});
