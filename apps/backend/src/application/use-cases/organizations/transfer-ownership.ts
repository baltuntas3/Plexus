import { OrganizationMembershipEvent } from "../../../domain/entities/organization-membership-event.js";
import {
  OrganizationMemberNotFoundError,
  OrganizationNotFoundError,
  OrganizationOwnerInvariantError,
} from "../../../domain/errors/domain-error.js";
import type { IOrganizationMemberRepository } from "../../../domain/repositories/organization-member-repository.js";
import type { IOrganizationMembershipEventRepository } from "../../../domain/repositories/organization-membership-event-repository.js";
import type { IOrganizationRepository } from "../../../domain/repositories/organization-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import type { IUnitOfWork } from "../../../domain/services/unit-of-work.js";
import type { TransferOwnershipInputDto } from "../../dto/organization-dto.js";

export interface TransferOwnershipCommand extends TransferOwnershipInputDto {
  organizationId: string;
  // Verified to be the current owner before the transfer is applied.
  // Authorization middleware (`requirePermission("ownership:transfer")`)
  // already gates the route to owners, but this use case re-checks
  // against the org root pointer as defense-in-depth.
  actorUserId: string;
}

// Ownership transfer is the only path that legitimately mutates the
// `owner` role on an `OrganizationMember`. It atomically:
//   1. demotes the outgoing owner to admin
//   2. promotes the incoming member to owner
//   3. updates the Organization root's `ownerId` pointer
// The three writes live in a single UoW so the "exactly one owner"
// invariant is never observable as broken from a concurrent reader.
export class TransferOwnershipUseCase {
  constructor(
    private readonly organizations: IOrganizationRepository,
    private readonly memberships: IOrganizationMemberRepository,
    private readonly events: IOrganizationMembershipEventRepository,
    private readonly idGenerator: IIdGenerator,
    private readonly uow: IUnitOfWork,
  ) {}

  async execute(command: TransferOwnershipCommand): Promise<void> {
    if (command.actorUserId === command.newOwnerUserId) {
      throw OrganizationOwnerInvariantError(
        "Cannot transfer ownership to yourself",
      );
    }

    const organization = await this.organizations.findById(command.organizationId);
    if (!organization) {
      throw OrganizationNotFoundError();
    }
    // Defense-in-depth: middleware already restricts the route to
    // owner-permission, but a stale token whose user is no longer owner
    // would otherwise pass. The org root is the source of truth.
    if (organization.ownerId !== command.actorUserId) {
      throw OrganizationOwnerInvariantError(
        "Only the current owner can transfer ownership",
      );
    }

    const outgoing = await this.memberships.findByOrganizationAndUser(
      command.organizationId,
      command.actorUserId,
    );
    const incoming = await this.memberships.findByOrganizationAndUser(
      command.organizationId,
      command.newOwnerUserId,
    );
    if (!outgoing || !incoming) {
      // Either side missing → can't preserve the invariant. The
      // incoming user must already be a member of the org; transfer
      // does not double as an invitation.
      throw OrganizationMemberNotFoundError();
    }

    // Capture the incoming member's pre-transfer role for the audit
    // event before applying the mutation. Without this, the log would
    // claim the new owner came from "admin" regardless of their actual
    // prior role (could be editor, approver, viewer) — incident-response
    // queries against the audit trail would surface fabricated history.
    const incomingPriorRole = incoming.role;
    outgoing.applyOwnershipTransfer("demote");
    incoming.applyOwnershipTransfer("promote");
    organization.setOwnerId(command.newOwnerUserId);

    await this.uow.run(async () => {
      // Outgoing first so concurrent reads never see two owner rows
      // for the same org. The DB-level unique constraint on the org
      // pointer holds anyway; this is defensive ordering for the
      // interleavings the ALS-bound session permits.
      await this.memberships.save(outgoing);
      await this.memberships.save(incoming);
      await this.organizations.save(organization);
      // Single event recording the incoming user's promotion to owner.
      // Outgoing's owner→admin demotion is implicit in the event type
      // (`ownership_transferred` is always paired with the demotion);
      // emitting a second `role_changed` row would double-count what
      // the timeline tells you at a glance.
      const event = OrganizationMembershipEvent.create({
        id: this.idGenerator.newId(),
        organizationId: command.organizationId,
        eventType: "ownership_transferred",
        actorUserId: command.actorUserId,
        targetUserId: command.newOwnerUserId,
        oldRole: incomingPriorRole,
        newRole: "owner",
      });
      await this.events.append(event);
    });
  }
}
