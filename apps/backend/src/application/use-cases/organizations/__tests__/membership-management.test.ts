import { OrganizationMember } from "../../../../domain/entities/organization-member.js";
import { Organization } from "../../../../domain/entities/organization.js";
import { UpdateMemberRoleUseCase } from "../update-member-role.js";
import { RemoveMemberUseCase } from "../remove-member.js";
import { TransferOwnershipUseCase } from "../transfer-ownership.js";
import { InMemoryOrganizationRepository } from "../../../../__tests__/fakes/in-memory-organization-repository.js";
import { InMemoryOrganizationMemberRepository } from "../../../../__tests__/fakes/in-memory-organization-member-repository.js";
import { InMemoryOrganizationMembershipEventRepository } from "../../../../__tests__/fakes/in-memory-organization-membership-event-repository.js";
import { InMemoryIdGenerator } from "../../../../__tests__/fakes/in-memory-id-generator.js";
import { NoOpUnitOfWork } from "../../../../__tests__/fakes/no-op-unit-of-work.js";

const setup = async () => {
  const organizations = new InMemoryOrganizationRepository();
  const memberships = new InMemoryOrganizationMemberRepository();
  const events = new InMemoryOrganizationMembershipEventRepository();
  const ids = new InMemoryIdGenerator();
  const uow = new NoOpUnitOfWork();

  const org = Organization.create({
    organizationId: "org-1",
    name: "Acme",
    slug: "acme",
    ownerId: "u-owner",
  });
  await organizations.save(org);

  const owner = OrganizationMember.create({
    id: "m-owner",
    organizationId: "org-1",
    userId: "u-owner",
    role: "owner",
  });
  const editor = OrganizationMember.create({
    id: "m-editor",
    organizationId: "org-1",
    userId: "u-editor",
    role: "editor",
  });
  await memberships.save(owner);
  await memberships.save(editor);

  return {
    organizations,
    memberships,
    events,
    updateRole: new UpdateMemberRoleUseCase(memberships, events, ids, uow),
    remove: new RemoveMemberUseCase(memberships, events, ids, uow),
    transfer: new TransferOwnershipUseCase(
      organizations,
      memberships,
      events,
      ids,
      uow,
    ),
  };
};

describe("UpdateMemberRole", () => {
  it("changes role and audits", async () => {
    const { updateRole, memberships, events } = await setup();
    await updateRole.execute({
      organizationId: "org-1",
      actorUserId: "u-owner",
      targetMemberId: "m-editor",
      role: "approver",
    });
    const reloaded = await memberships.findById("m-editor");
    expect(reloaded?.role).toBe("approver");
    const log = await events.listByOrganization("org-1");
    expect(log[0]?.eventType).toBe("role_changed");
    expect(log[0]?.oldRole).toBe("editor");
    expect(log[0]?.newRole).toBe("approver");
  });

  it("rejects self-edit", async () => {
    const { updateRole } = await setup();
    await expect(
      updateRole.execute({
        organizationId: "org-1",
        actorUserId: "u-owner",
        targetMemberId: "m-owner",
        role: "admin",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses to assign owner role through this path", async () => {
    const { updateRole } = await setup();
    await expect(
      updateRole.execute({
        organizationId: "org-1",
        actorUserId: "u-owner",
        targetMemberId: "m-editor",
        // @ts-expect-error — DTO statically forbids owner; runtime guard is on the aggregate.
        role: "owner",
      }),
    ).rejects.toMatchObject({ code: "ORGANIZATION_OWNER_INVARIANT" });
  });
});

describe("RemoveMember", () => {
  it("hard-deletes a non-owner member and audits", async () => {
    const { remove, memberships, events } = await setup();
    await remove.execute({
      organizationId: "org-1",
      actorUserId: "u-owner",
      targetMemberId: "m-editor",
    });
    expect(await memberships.findById("m-editor")).toBeNull();
    const log = await events.listByOrganization("org-1");
    expect(log[0]?.eventType).toBe("removed");
    expect(log[0]?.oldRole).toBe("editor");
  });

  it("rejects removing yourself", async () => {
    const { remove } = await setup();
    await expect(
      remove.execute({
        organizationId: "org-1",
        actorUserId: "u-owner",
        targetMemberId: "m-owner",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("blocks removing the owner without transfer first", async () => {
    const { remove, memberships } = await setup();
    // A different admin tries to remove the owner.
    const admin = OrganizationMember.create({
      id: "m-admin",
      organizationId: "org-1",
      userId: "u-admin",
      role: "admin",
    });
    await memberships.save(admin);
    await expect(
      remove.execute({
        organizationId: "org-1",
        actorUserId: "u-admin",
        targetMemberId: "m-owner",
      }),
    ).rejects.toMatchObject({ code: "ORGANIZATION_LAST_OWNER" });
  });
});

describe("TransferOwnership", () => {
  it("flips owner ↔ admin atomically and updates the org pointer", async () => {
    const { transfer, organizations, memberships, events } = await setup();
    await transfer.execute({
      organizationId: "org-1",
      actorUserId: "u-owner",
      newOwnerUserId: "u-editor",
    });
    const org = await organizations.findById("org-1");
    expect(org?.ownerId).toBe("u-editor");

    const newOwner = await memberships.findById("m-editor");
    const oldOwner = await memberships.findById("m-owner");
    expect(newOwner?.role).toBe("owner");
    expect(oldOwner?.role).toBe("admin");

    const log = await events.listByOrganization("org-1");
    const transferEvent = log.find(
      (e) => e.eventType === "ownership_transferred",
    );
    expect(transferEvent).toBeDefined();
    // oldRole captures the incoming user's actual pre-transfer role
    // (editor in this fixture), not a hard-coded "admin". A real
    // incident review against the audit trail depends on this being
    // correct.
    expect(transferEvent?.oldRole).toBe("editor");
    expect(transferEvent?.newRole).toBe("owner");
    expect(transferEvent?.targetUserId).toBe("u-editor");
    expect(transferEvent?.actorUserId).toBe("u-owner");
  });

  it("captures the incoming user's prior role even when it isn't admin", async () => {
    // Regression guard for the previous hard-coded `oldRole: "admin"`.
    // Promote a viewer (not an admin) and assert the audit reflects it.
    const { transfer, memberships, events } = await setup();
    const viewer = (
      await import("../../../../domain/entities/organization-member.js")
    ).OrganizationMember.create({
      id: "m-viewer",
      organizationId: "org-1",
      userId: "u-viewer",
      role: "viewer",
    });
    await memberships.save(viewer);

    await transfer.execute({
      organizationId: "org-1",
      actorUserId: "u-owner",
      newOwnerUserId: "u-viewer",
    });

    const log = await events.listByOrganization("org-1");
    const transferEvent = log.find(
      (e) => e.eventType === "ownership_transferred",
    );
    expect(transferEvent?.oldRole).toBe("viewer");
  });

  it("rejects transfer to self", async () => {
    const { transfer } = await setup();
    await expect(
      transfer.execute({
        organizationId: "org-1",
        actorUserId: "u-owner",
        newOwnerUserId: "u-owner",
      }),
    ).rejects.toMatchObject({ code: "ORGANIZATION_OWNER_INVARIANT" });
  });

  it("rejects transfer initiated by a non-owner", async () => {
    const { transfer } = await setup();
    await expect(
      transfer.execute({
        organizationId: "org-1",
        actorUserId: "u-editor",
        newOwnerUserId: "u-owner",
      }),
    ).rejects.toMatchObject({ code: "ORGANIZATION_OWNER_INVARIANT" });
  });

  it("rejects transfer to a non-member", async () => {
    const { transfer } = await setup();
    await expect(
      transfer.execute({
        organizationId: "org-1",
        actorUserId: "u-owner",
        newOwnerUserId: "u-stranger",
      }),
    ).rejects.toMatchObject({ code: "ORGANIZATION_MEMBER_NOT_FOUND" });
  });
});
