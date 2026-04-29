import { MongoOrganizationRepository } from "../infrastructure/persistence/mongoose/mongo-organization-repository.js";
import { MongoOrganizationMemberRepository } from "../infrastructure/persistence/mongoose/mongo-organization-member-repository.js";
import { MongoOrganizationInvitationRepository } from "../infrastructure/persistence/mongoose/mongo-organization-invitation-repository.js";
import { MongoOrganizationMembershipEventRepository } from "../infrastructure/persistence/mongoose/mongo-organization-membership-event-repository.js";
import { MongoObjectIdGenerator } from "../infrastructure/persistence/mongoose/object-id-generator.js";
import { MongoUnitOfWork } from "../infrastructure/persistence/mongoose/mongo-unit-of-work.js";
import { InviteMemberUseCase } from "../application/use-cases/organizations/invite-member.js";
import { CancelInvitationUseCase } from "../application/use-cases/organizations/cancel-invitation.js";
import { AcceptInvitationUseCase } from "../application/use-cases/organizations/accept-invitation.js";
import { UpdateMemberRoleUseCase } from "../application/use-cases/organizations/update-member-role.js";
import { RemoveMemberUseCase } from "../application/use-cases/organizations/remove-member.js";
import { TransferOwnershipUseCase } from "../application/use-cases/organizations/transfer-ownership.js";

// Membership/invitation use cases live in their own composition root so
// the auth bundle stays focused on "issuing tokens" and the prompt /
// benchmark contexts stay focused on their domain. Shared infrastructure
// (idGenerator, uow) is instantiated locally — the cost is two extra
// stateless objects, the gain is each context can be torn down or
// reasoned about in isolation.
export interface OrganizationComposition {
  inviteMember: InviteMemberUseCase;
  cancelInvitation: CancelInvitationUseCase;
  acceptInvitation: AcceptInvitationUseCase;
  updateMemberRole: UpdateMemberRoleUseCase;
  removeMember: RemoveMemberUseCase;
  transferOwnership: TransferOwnershipUseCase;
}

export const createOrganizationComposition = (): OrganizationComposition => {
  const organizations = new MongoOrganizationRepository();
  const memberships = new MongoOrganizationMemberRepository();
  const invitations = new MongoOrganizationInvitationRepository();
  const events = new MongoOrganizationMembershipEventRepository();
  const idGenerator = new MongoObjectIdGenerator();
  const uow = new MongoUnitOfWork();

  return {
    inviteMember: new InviteMemberUseCase(invitations, events, idGenerator, uow),
    cancelInvitation: new CancelInvitationUseCase(
      invitations,
      events,
      idGenerator,
      uow,
    ),
    acceptInvitation: new AcceptInvitationUseCase(
      invitations,
      memberships,
      events,
      idGenerator,
      uow,
    ),
    updateMemberRole: new UpdateMemberRoleUseCase(
      memberships,
      events,
      idGenerator,
      uow,
    ),
    removeMember: new RemoveMemberUseCase(
      memberships,
      events,
      idGenerator,
      uow,
    ),
    transferOwnership: new TransferOwnershipUseCase(
      organizations,
      memberships,
      events,
      idGenerator,
      uow,
    ),
  };
};
