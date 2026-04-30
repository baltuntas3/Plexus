import type { OrganizationInvitationDto } from "@plexus/shared-types";
import { OrganizationInvitation } from "../../../domain/entities/organization-invitation.js";
import { OrganizationMembershipEvent } from "../../../domain/entities/organization-membership-event.js";
import type { IOrganizationInvitationRepository } from "../../../domain/repositories/organization-invitation-repository.js";
import type { IOrganizationMembershipEventRepository } from "../../../domain/repositories/organization-membership-event-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import type { IUnitOfWork } from "../../../domain/services/unit-of-work.js";
import { generateInvitationToken } from "../../services/invitation-token.js";
import type { InviteMemberInputDto } from "../../dto/organization-dto.js";
import { toInvitationDto } from "../../queries/organization-projections.js";

export interface InviteMemberCommand extends InviteMemberInputDto {
  organizationId: string;
  // The user issuing the invitation. Stored as `invitedBy` on the
  // aggregate and as `actorUserId` on the audit event.
  actorUserId: string;
}

export interface InviteMemberResult {
  // Public DTO — caller never sees the raw aggregate or the persisted
  // `tokenHash`. Mapping happens here so every invitation projection
  // (issue, list, future audit views) uses one shape from one place.
  invitation: OrganizationInvitationDto;
  // Plaintext token returned exactly once. Caller forwards it to the
  // recipient via the invitation link; storage never sees the
  // plaintext, only its SHA-256 hash.
  plaintextToken: string;
}

// 7 days is the platform-level default invitation lifetime. Encoded
// here (not in the domain entity) because it's a use-case policy
// decision: a future "admin-configurable per-org TTL" would change this
// constant or pull it from `ApprovalPolicy`-style config without
// touching the aggregate's invariants.
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class InviteMemberUseCase {
  constructor(
    private readonly invitations: IOrganizationInvitationRepository,
    private readonly events: IOrganizationMembershipEventRepository,
    private readonly idGenerator: IIdGenerator,
    private readonly uow: IUnitOfWork,
  ) {}

  async execute(command: InviteMemberCommand): Promise<InviteMemberResult> {
    const { plaintext, hash } = generateInvitationToken();
    const now = new Date();
    const invitation = OrganizationInvitation.create({
      id: this.idGenerator.newId(),
      organizationId: command.organizationId,
      email: command.email,
      role: command.role,
      invitedBy: command.actorUserId,
      tokenHash: hash,
      expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
      createdAt: now,
    });

    await this.uow.run(async () => {
      // The unique partial index on `(organizationId, email)` for
      // pending rows surfaces a domain error if a previous pending
      // invitation has not been cancelled yet. We translate at the
      // repo boundary, not here.
      await this.invitations.save(invitation);
      const event = OrganizationMembershipEvent.create({
        id: this.idGenerator.newId(),
        organizationId: command.organizationId,
        eventType: "invited",
        actorUserId: command.actorUserId,
        targetEmail: invitation.email,
        newRole: invitation.role,
      });
      await this.events.append(event);
    });

    return { invitation: toInvitationDto(invitation), plaintextToken: plaintext };
  }
}
