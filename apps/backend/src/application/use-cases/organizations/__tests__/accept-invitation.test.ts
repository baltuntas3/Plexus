import { AcceptInvitationUseCase } from "../accept-invitation.js";
import { InviteMemberUseCase } from "../invite-member.js";
import { InMemoryOrganizationInvitationRepository } from "../../../../__tests__/fakes/in-memory-organization-invitation-repository.js";
import { InMemoryOrganizationMemberRepository } from "../../../../__tests__/fakes/in-memory-organization-member-repository.js";
import { InMemoryOrganizationMembershipEventRepository } from "../../../../__tests__/fakes/in-memory-organization-membership-event-repository.js";
import { InMemoryIdGenerator } from "../../../../__tests__/fakes/in-memory-id-generator.js";
import { NoOpUnitOfWork } from "../../../../__tests__/fakes/no-op-unit-of-work.js";

const setup = () => {
  const invitations = new InMemoryOrganizationInvitationRepository();
  const memberships = new InMemoryOrganizationMemberRepository();
  const events = new InMemoryOrganizationMembershipEventRepository();
  const ids = new InMemoryIdGenerator();
  const uow = new NoOpUnitOfWork();
  return {
    invitations,
    memberships,
    events,
    invite: new InviteMemberUseCase(invitations, events, ids, uow),
    accept: new AcceptInvitationUseCase(
      invitations,
      memberships,
      events,
      ids,
      uow,
    ),
  };
};

describe("AcceptInvitation", () => {
  it("creates a member, marks the invitation accepted, and audits 'joined'", async () => {
    const { invite, accept, invitations, memberships, events } = setup();
    const issued = await invite.execute({
      organizationId: "org-1",
      actorUserId: "u-admin",
      email: "alice@example.com",
      role: "editor",
    });

    const result = await accept.execute({
      token: issued.plaintextToken,
      actorUserId: "u-alice",
      actorEmail: "Alice@Example.COM",
    });

    expect(result.organizationId).toBe("org-1");
    expect(result.member.role).toBe("editor");
    expect(result.member.userId).toBe("u-alice");
    expect(result.member.invitedBy).toBe("u-admin");

    const inv = await invitations.findById(issued.invitation.id);
    expect(inv?.status).toBe("accepted");
    expect(inv?.resolvedAt).toBeInstanceOf(Date);

    const member = await memberships.findByOrganizationAndUser("org-1", "u-alice");
    expect(member?.id).toBe(result.member.id);

    const log = await events.listByOrganization("org-1");
    expect(log).toHaveLength(2);
    expect(log.map((e) => e.eventType).sort()).toEqual(["invited", "joined"]);
    const joined = log.find((e) => e.eventType === "joined");
    expect(joined?.targetUserId).toBe("u-alice");
    expect(joined?.newRole).toBe("editor");
  });

  it("rejects a token that doesn't match any invitation", async () => {
    const { accept } = setup();
    await expect(
      accept.execute({
        token: "0".repeat(64),
        actorUserId: "u-alice",
        actorEmail: "alice@example.com",
      }),
    ).rejects.toMatchObject({ code: "ORGANIZATION_INVITATION_NOT_FOUND" });
  });

  it("rejects redemption by a different email than the invitation target", async () => {
    const { invite, accept } = setup();
    const issued = await invite.execute({
      organizationId: "org-1",
      actorUserId: "u-admin",
      email: "alice@example.com",
      role: "editor",
    });
    await expect(
      accept.execute({
        token: issued.plaintextToken,
        actorUserId: "u-eve",
        actorEmail: "eve@example.com",
      }),
    ).rejects.toMatchObject({
      code: "ORGANIZATION_INVITATION_EMAIL_MISMATCH",
    });
  });

  // The "past expiresAt → EXPIRED + persisted as expired" path is
  // covered by the OrganizationInvitation domain test
  // ("refuses to accept after expiresAt" / "markExpired flips pending →
  // expired"). Replaying it at the use-case level under ESM fake timers
  // adds friction without a new assertion the aggregate doesn't already
  // guarantee.

  it("refuses to accept twice (status no longer pending)", async () => {
    const { invite, accept } = setup();
    const issued = await invite.execute({
      organizationId: "org-1",
      actorUserId: "u-admin",
      email: "alice@example.com",
      role: "editor",
    });
    await accept.execute({
      token: issued.plaintextToken,
      actorUserId: "u-alice",
      actorEmail: "alice@example.com",
    });
    await expect(
      accept.execute({
        token: issued.plaintextToken,
        actorUserId: "u-alice2",
        actorEmail: "alice@example.com",
      }),
    ).rejects.toMatchObject({ code: "ORGANIZATION_INVITATION_NOT_ACTIVE" });
  });
});
