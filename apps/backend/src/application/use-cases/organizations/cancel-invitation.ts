import { OrganizationMembershipEvent } from "../../../domain/entities/organization-membership-event.js";
import { OrganizationInvitationNotFoundError } from "../../../domain/errors/domain-error.js";
import type { IOrganizationInvitationRepository } from "../../../domain/repositories/organization-invitation-repository.js";
import type { IOrganizationMembershipEventRepository } from "../../../domain/repositories/organization-membership-event-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import type { IUnitOfWork } from "../../../domain/services/unit-of-work.js";

export interface CancelInvitationCommand {
  organizationId: string;
  actorUserId: string;
  invitationId: string;
}

export class CancelInvitationUseCase {
  constructor(
    private readonly invitations: IOrganizationInvitationRepository,
    private readonly events: IOrganizationMembershipEventRepository,
    private readonly idGenerator: IIdGenerator,
    private readonly uow: IUnitOfWork,
  ) {}

  async execute(command: CancelInvitationCommand): Promise<void> {
    const invitation = await this.invitations.findById(command.invitationId);
    // Combined "missing" + "wrong org" into one not-found so id
    // enumeration cannot distinguish them across tenants.
    if (!invitation || invitation.organizationId !== command.organizationId) {
      throw OrganizationInvitationNotFoundError();
    }
    invitation.cancel();
    await this.uow.run(async () => {
      await this.invitations.save(invitation);
      const event = OrganizationMembershipEvent.create({
        id: this.idGenerator.newId(),
        organizationId: command.organizationId,
        eventType: "cancelled",
        actorUserId: command.actorUserId,
        targetEmail: invitation.email,
        oldRole: invitation.role,
      });
      await this.events.append(event);
    });
  }
}
