import { MongoOrganizationRepository } from "../infrastructure/persistence/mongoose/mongo-organization-repository.js";
import { MongoOrganizationMemberRepository } from "../infrastructure/persistence/mongoose/mongo-organization-member-repository.js";
import { MongoOrganizationInvitationRepository } from "../infrastructure/persistence/mongoose/mongo-organization-invitation-repository.js";
import { MongoOrganizationMembershipEventRepository } from "../infrastructure/persistence/mongoose/mongo-organization-membership-event-repository.js";
import { MongoPromptAggregateRepository } from "../infrastructure/persistence/mongoose/mongo-prompt-aggregate-repository.js";
import { MongoPromptVersionRepository } from "../infrastructure/persistence/mongoose/mongo-prompt-version-repository.js";
import { MongoVersionApprovalRequestRepository } from "../infrastructure/persistence/mongoose/mongo-version-approval-request-repository.js";
import { MongoObjectIdGenerator } from "../infrastructure/persistence/mongoose/object-id-generator.js";
import { MongoUnitOfWork } from "../infrastructure/persistence/mongoose/mongo-unit-of-work.js";
import { InviteMemberUseCase } from "../application/use-cases/organizations/invite-member.js";
import { CancelInvitationUseCase } from "../application/use-cases/organizations/cancel-invitation.js";
import { AcceptInvitationUseCase } from "../application/use-cases/organizations/accept-invitation.js";
import { UpdateMemberRoleUseCase } from "../application/use-cases/organizations/update-member-role.js";
import { RemoveMemberUseCase } from "../application/use-cases/organizations/remove-member.js";
import { TransferOwnershipUseCase } from "../application/use-cases/organizations/transfer-ownership.js";
import { ListMembersUseCase } from "../application/use-cases/organizations/list-members.js";
import { ListInvitationsUseCase } from "../application/use-cases/organizations/list-invitations.js";
import { ListMembershipEventsUseCase } from "../application/use-cases/organizations/list-membership-events.js";
import { SetApprovalPolicyUseCase } from "../application/use-cases/organizations/set-approval-policy.js";
import { RequestVersionApprovalUseCase } from "../application/use-cases/organizations/request-version-approval.js";
import { ApproveVersionRequestUseCase } from "../application/use-cases/organizations/approve-version-request.js";
import { RejectVersionRequestUseCase } from "../application/use-cases/organizations/reject-version-request.js";
import { CancelVersionRequestUseCase } from "../application/use-cases/organizations/cancel-version-request.js";
import { ListPendingApprovalRequestsUseCase } from "../application/use-cases/organizations/list-pending-approval-requests.js";

// Membership/invitation/approval use cases live in their own composition
// root so the auth bundle stays focused on "issuing tokens" and the
// prompt / benchmark contexts stay focused on their domain. The
// approval-workflow use cases need prompt + version repositories
// (auto-promotion on threshold); those stateless adapters are
// instantiated locally — the cost is a few extra stateless objects, the
// gain is each context can be torn down or reasoned about in isolation.
export interface OrganizationComposition {
  inviteMember: InviteMemberUseCase;
  cancelInvitation: CancelInvitationUseCase;
  acceptInvitation: AcceptInvitationUseCase;
  updateMemberRole: UpdateMemberRoleUseCase;
  removeMember: RemoveMemberUseCase;
  transferOwnership: TransferOwnershipUseCase;
  listMembers: ListMembersUseCase;
  listInvitations: ListInvitationsUseCase;
  listMembershipEvents: ListMembershipEventsUseCase;
  setApprovalPolicy: SetApprovalPolicyUseCase;
  requestVersionApproval: RequestVersionApprovalUseCase;
  approveVersionRequest: ApproveVersionRequestUseCase;
  rejectVersionRequest: RejectVersionRequestUseCase;
  cancelVersionRequest: CancelVersionRequestUseCase;
  listPendingApprovalRequests: ListPendingApprovalRequestsUseCase;
}

export const createOrganizationComposition = (): OrganizationComposition => {
  const organizations = new MongoOrganizationRepository();
  const memberships = new MongoOrganizationMemberRepository();
  const invitations = new MongoOrganizationInvitationRepository();
  const events = new MongoOrganizationMembershipEventRepository();
  const prompts = new MongoPromptAggregateRepository();
  const versions = new MongoPromptVersionRepository();
  const approvals = new MongoVersionApprovalRequestRepository();
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
    listMembers: new ListMembersUseCase(memberships),
    listInvitations: new ListInvitationsUseCase(invitations),
    listMembershipEvents: new ListMembershipEventsUseCase(events),
    setApprovalPolicy: new SetApprovalPolicyUseCase(organizations),
    requestVersionApproval: new RequestVersionApprovalUseCase(
      organizations,
      prompts,
      versions,
      approvals,
      idGenerator,
    ),
    approveVersionRequest: new ApproveVersionRequestUseCase(
      approvals,
      prompts,
      versions,
      uow,
    ),
    rejectVersionRequest: new RejectVersionRequestUseCase(
      approvals,
      prompts,
      versions,
    ),
    cancelVersionRequest: new CancelVersionRequestUseCase(
      approvals,
      prompts,
      versions,
    ),
    listPendingApprovalRequests: new ListPendingApprovalRequestsUseCase(
      approvals,
      prompts,
      versions,
    ),
  };
};
