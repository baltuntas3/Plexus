import { OrganizationMembershipEvent } from "../../../domain/entities/organization-membership-event.js";
import {
  OrganizationMemberNotFoundError,
  OrganizationNotFoundError,
} from "../../../domain/errors/domain-error.js";
import type { IOrganizationMemberRepository } from "../../../domain/repositories/organization-member-repository.js";
import type { IOrganizationMembershipEventRepository } from "../../../domain/repositories/organization-membership-event-repository.js";
import type { IOrganizationRepository } from "../../../domain/repositories/organization-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import { transferOrganizationOwnership } from "../../../domain/services/transfer-organization-ownership.js";
import type { IUnitOfWork } from "../../../domain/services/unit-of-work.js";
import type { TransferOwnershipInputDto } from "../../dto/organization-dto.js";

export interface TransferOwnershipCommand extends TransferOwnershipInputDto {
  organizationId: string;
  // Verified to be the current owner before the transfer is applied.
  // Authorization middleware (`requirePermission("ownership:transfer")`)
  // already gates the route to owners; the domain service double-checks
  // against the org root pointer as defense-in-depth.
  actorUserId: string;
}

// Ownership transfer orchestration. The cross-aggregate invariant
// ("exactly one owner; root pointer matches the owner-role member row")
// is enforced by the `transferOrganizationOwnership` domain service so
// this use case only handles authentication, loading, persistence, and
// audit-event emission. All three mutations land in a single UoW so a
// concurrent reader never observes a half-applied transfer.
export class TransferOwnershipUseCase {
  constructor(
    private readonly organizations: IOrganizationRepository,
    private readonly memberships: IOrganizationMemberRepository,
    private readonly events: IOrganizationMembershipEventRepository,
    private readonly idGenerator: IIdGenerator,
    private readonly uow: IUnitOfWork,
  ) {}

  async execute(command: TransferOwnershipCommand): Promise<void> {
    const organization = await this.organizations.findById(command.organizationId);
    if (!organization) {
      throw OrganizationNotFoundError();
    }

    const outgoingMember = await this.memberships.findByOrganizationAndUser(
      command.organizationId,
      command.actorUserId,
    );
    const incomingMember = await this.memberships.findByOrganizationAndUser(
      command.organizationId,
      command.newOwnerUserId,
    );
    if (!outgoingMember || !incomingMember) {
      // Either side missing → can't preserve the invariant. The incoming
      // user must already be a member of the org; transfer does not double
      // as an invitation.
      throw OrganizationMemberNotFoundError();
    }

    const { incomingPriorRole } = transferOrganizationOwnership({
      organization,
      outgoingMember,
      incomingMember,
      actorUserId: command.actorUserId,
      newOwnerUserId: command.newOwnerUserId,
    });

    await this.uow.run(async () => {
      // Outgoing first so concurrent reads never see two owner rows for
      // the same org during the in-flight transaction.
      await this.memberships.save(outgoingMember);
      await this.memberships.save(incomingMember);
      await this.organizations.save(organization);
      // Single event recording the incoming user's promotion to owner.
      // Outgoing's owner→admin demotion is implicit in the event type
      // (`ownership_transferred` is always paired with the demotion);
      // emitting a second `role_changed` row would double-count what the
      // timeline tells you at a glance.
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
