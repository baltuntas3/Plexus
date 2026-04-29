import { OrganizationMembershipEvent } from "../../../domain/entities/organization-membership-event.js";
import {
  ForbiddenError,
  OrganizationLastOwnerError,
  OrganizationMemberNotFoundError,
} from "../../../domain/errors/domain-error.js";
import type { IOrganizationMemberRepository } from "../../../domain/repositories/organization-member-repository.js";
import type { IOrganizationMembershipEventRepository } from "../../../domain/repositories/organization-membership-event-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import type { IUnitOfWork } from "../../../domain/services/unit-of-work.js";

export interface RemoveMemberCommand {
  organizationId: string;
  actorUserId: string;
  targetMemberId: string;
}

export class RemoveMemberUseCase {
  constructor(
    private readonly memberships: IOrganizationMemberRepository,
    private readonly events: IOrganizationMembershipEventRepository,
    private readonly idGenerator: IIdGenerator,
    private readonly uow: IUnitOfWork,
  ) {}

  async execute(command: RemoveMemberCommand): Promise<void> {
    const member = await this.memberships.findById(command.targetMemberId);
    if (!member || member.organizationId !== command.organizationId) {
      throw OrganizationMemberNotFoundError();
    }
    // Self-removal is prohibited. The user closing their own access
    // would also lock themselves out of the audit trail; transfer
    // ownership first if you want to leave an org you own.
    if (member.userId === command.actorUserId) {
      throw ForbiddenError("Cannot remove yourself from the organization");
    }
    // The single-owner invariant: removing the owner directly would
    // strand the org with no owner. The remediation is `TransferOwnership`
    // first, then remove. Distinguished from the generic owner-invariant
    // error so the UI can offer the "transfer then remove" path
    // explicitly.
    if (member.role === "owner") {
      throw OrganizationLastOwnerError();
    }

    const oldRole = member.role;
    await this.uow.run(async () => {
      await this.memberships.remove(member.id);
      const event = OrganizationMembershipEvent.create({
        id: this.idGenerator.newId(),
        organizationId: command.organizationId,
        eventType: "removed",
        actorUserId: command.actorUserId,
        targetUserId: member.userId,
        oldRole,
      });
      await this.events.append(event);
    });
  }
}
