import { InviteMemberUseCase } from "../invite-member.js";
import { CancelInvitationUseCase } from "../cancel-invitation.js";
import { InMemoryOrganizationInvitationRepository } from "../../../../__tests__/fakes/in-memory-organization-invitation-repository.js";
import { InMemoryOrganizationMembershipEventRepository } from "../../../../__tests__/fakes/in-memory-organization-membership-event-repository.js";
import { InMemoryIdGenerator } from "../../../../__tests__/fakes/in-memory-id-generator.js";
import { NoOpUnitOfWork } from "../../../../__tests__/fakes/no-op-unit-of-work.js";

const setup = () => {
  const invitations = new InMemoryOrganizationInvitationRepository();
  const events = new InMemoryOrganizationMembershipEventRepository();
  const ids = new InMemoryIdGenerator();
  const uow = new NoOpUnitOfWork();
  return {
    invitations,
    events,
    invite: new InviteMemberUseCase(invitations, events, ids, uow),
    cancel: new CancelInvitationUseCase(invitations, events, ids, uow),
  };
};

describe("InviteMember", () => {
  it("issues a pending invitation, returns the plaintext token, and audits", async () => {
    const { invite, invitations, events } = setup();
    const result = await invite.execute({
      organizationId: "org-1",
      actorUserId: "u-admin",
      email: "Alice@Example.com",
      role: "editor",
    });

    expect(result.plaintextToken).toMatch(/^[0-9a-f]{64}$/);
    expect(result.invitation.email).toBe("alice@example.com");
    expect(result.invitation.status).toBe("pending");
    expect(result.invitation.role).toBe("editor");
    expect(result.invitation.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const stored = await invitations.findById(result.invitation.id);
    expect(stored?.tokenHash).toBe(result.invitation.tokenHash);

    const log = await events.listByOrganization("org-1");
    expect(log).toHaveLength(1);
    expect(log[0]?.eventType).toBe("invited");
    expect(log[0]?.targetEmail).toBe("alice@example.com");
    expect(log[0]?.newRole).toBe("editor");
  });

  it("never returns the same plaintext for two issuances", async () => {
    const { invite } = setup();
    const a = await invite.execute({
      organizationId: "org-1",
      actorUserId: "u-admin",
      email: "alice@example.com",
      role: "editor",
    });
    const b = await invite.execute({
      organizationId: "org-1",
      actorUserId: "u-admin",
      email: "bob@example.com",
      role: "viewer",
    });
    expect(a.plaintextToken).not.toEqual(b.plaintextToken);
    expect(a.invitation.tokenHash).not.toEqual(b.invitation.tokenHash);
  });

  it("rejects a second pending invitation for the same email until cancelled", async () => {
    const { invite, cancel } = setup();
    const first = await invite.execute({
      organizationId: "org-1",
      actorUserId: "u-admin",
      email: "alice@example.com",
      role: "editor",
    });

    await expect(
      invite.execute({
        organizationId: "org-1",
        actorUserId: "u-admin",
        email: "alice@example.com",
        role: "viewer",
      }),
    ).rejects.toMatchObject({ code: "ORGANIZATION_INVITATION_ALREADY_PENDING" });

    // Re-invite path: cancel the existing one, then re-issue.
    await cancel.execute({
      organizationId: "org-1",
      actorUserId: "u-admin",
      invitationId: first.invitation.id,
    });
    const second = await invite.execute({
      organizationId: "org-1",
      actorUserId: "u-admin",
      email: "alice@example.com",
      role: "viewer",
    });
    expect(second.invitation.status).toBe("pending");
    expect(second.invitation.role).toBe("viewer");
  });

  it("rejects role=owner (reserved for ownership transfer)", async () => {
    const { invite } = setup();
    await expect(
      invite.execute({
        organizationId: "org-1",
        actorUserId: "u-admin",
        email: "alice@example.com",
        // @ts-expect-error — verifying runtime guard, the DTO enum forbids owner statically.
        role: "owner",
      }),
    ).rejects.toThrow(/owner role is reserved/);
  });
});

describe("CancelInvitation", () => {
  it("cancels a pending invitation and audits", async () => {
    const { invite, cancel, invitations, events } = setup();
    const issued = await invite.execute({
      organizationId: "org-1",
      actorUserId: "u-admin",
      email: "alice@example.com",
      role: "editor",
    });

    await cancel.execute({
      organizationId: "org-1",
      actorUserId: "u-admin",
      invitationId: issued.invitation.id,
    });

    const stored = await invitations.findById(issued.invitation.id);
    expect(stored?.status).toBe("cancelled");
    const log = await events.listByOrganization("org-1");
    expect(log).toHaveLength(2);
    expect(log.map((e) => e.eventType).sort()).toEqual([
      "cancelled",
      "invited",
    ]);
  });

  it("hides cross-org invitations as 404", async () => {
    const { invite, cancel } = setup();
    const issued = await invite.execute({
      organizationId: "org-1",
      actorUserId: "u-admin",
      email: "alice@example.com",
      role: "editor",
    });
    await expect(
      cancel.execute({
        organizationId: "other-org",
        actorUserId: "u-admin",
        invitationId: issued.invitation.id,
      }),
    ).rejects.toMatchObject({ code: "ORGANIZATION_INVITATION_NOT_FOUND" });
  });

  it("refuses to cancel a non-pending invitation", async () => {
    const { invite, cancel } = setup();
    const issued = await invite.execute({
      organizationId: "org-1",
      actorUserId: "u-admin",
      email: "alice@example.com",
      role: "editor",
    });
    await cancel.execute({
      organizationId: "org-1",
      actorUserId: "u-admin",
      invitationId: issued.invitation.id,
    });
    await expect(
      cancel.execute({
        organizationId: "org-1",
        actorUserId: "u-admin",
        invitationId: issued.invitation.id,
      }),
    ).rejects.toMatchObject({ code: "ORGANIZATION_INVITATION_NOT_ACTIVE" });
  });
});
