import { OrganizationMember } from "../../../domain/entities/organization-member.js";
import { OrganizationMembershipEvent } from "../../../domain/entities/organization-membership-event.js";
import {
  OrganizationInvitationEmailMismatchError,
  OrganizationInvitationExpiredError,
  OrganizationInvitationNotFoundError,
} from "../../../domain/errors/domain-error.js";
import type { IOrganizationInvitationRepository } from "../../../domain/repositories/organization-invitation-repository.js";
import type { IOrganizationMemberRepository } from "../../../domain/repositories/organization-member-repository.js";
import type { IOrganizationMembershipEventRepository } from "../../../domain/repositories/organization-membership-event-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import type { IUnitOfWork } from "../../../domain/services/unit-of-work.js";
import { hashInvitationToken } from "../../services/invitation-token.js";
import type { AcceptInvitationInputDto } from "../../dto/organization-dto.js";

interface AcceptInvitationCommand extends AcceptInvitationInputDto {
  // From the authenticated user's JWT claim — never trust a body-supplied
  // userId on a redemption flow; the link could be replayed by anyone.
  actorUserId: string;
  actorEmail: string;
}

interface AcceptInvitationResult {
  organizationId: string;
  // The newly-created membership row. The HTTP layer surfaces
  // `organizationId` so the frontend can switch the active org via a
  // re-login (or an explicit switch endpoint in Faz 1B-C frontend).
  member: OrganizationMember;
}

export class AcceptInvitationUseCase {
  constructor(
    private readonly invitations: IOrganizationInvitationRepository,
    private readonly memberships: IOrganizationMemberRepository,
    private readonly events: IOrganizationMembershipEventRepository,
    private readonly idGenerator: IIdGenerator,
    private readonly uow: IUnitOfWork,
  ) {}

  async execute(command: AcceptInvitationCommand): Promise<AcceptInvitationResult> {
    const tokenHash = hashInvitationToken(command.token);
    const invitation = await this.invitations.findByTokenHash(tokenHash);
    if (!invitation) {
      throw OrganizationInvitationNotFoundError();
    }

    // Email match is the second factor besides the token: a leaked
    // link is unusable if the recipient's email doesn't match. The
    // address comes from the JWT (verified at register/login), not from
    // request body.
    if (command.actorEmail.trim().toLowerCase() !== invitation.email) {
      throw OrganizationInvitationEmailMismatchError();
    }

    const now = new Date();
    if (invitation.isExpiredAt(now) && invitation.status === "pending") {
      // Lazy expiration: persist the terminal state so future redeem
      // attempts return a stable `EXPIRED` instead of repeating the
      // time check. Save outside the failure path so we don't fail to
      // record the transition when the throw fires.
      invitation.markExpired(now);
      await this.invitations.save(invitation);
      throw OrganizationInvitationExpiredError();
    }
    invitation.assertRedeemableAt(now);

    // Already-a-member edge case is left to the membership repo's unique
    // `(organizationId, userId)` index — Mongo and the in-memory fake
    // both translate that violation into OrganizationMemberAggregateStaleError
    // on save. Pre-checking would just race the same constraint.

    invitation.accept(now);
    const member = OrganizationMember.create({
      id: this.idGenerator.newId(),
      organizationId: invitation.organizationId,
      userId: command.actorUserId,
      role: invitation.role,
      invitedBy: invitation.invitedBy,
    });

    await this.uow.run(async () => {
      await this.invitations.save(invitation);
      await this.memberships.save(member);
      const event = OrganizationMembershipEvent.create({
        id: this.idGenerator.newId(),
        organizationId: invitation.organizationId,
        eventType: "joined",
        actorUserId: command.actorUserId,
        targetUserId: command.actorUserId,
        newRole: invitation.role,
      });
      await this.events.append(event);
    });

    return { organizationId: invitation.organizationId, member };
  }
}
