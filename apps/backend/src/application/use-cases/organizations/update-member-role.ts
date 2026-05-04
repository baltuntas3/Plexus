import { OrganizationMembershipEvent } from "../../../domain/entities/organization-membership-event.js";
import {
  ForbiddenError,
  OrganizationMemberNotFoundError,
} from "../../../domain/errors/domain-error.js";
import type { IOrganizationMemberRepository } from "../../../domain/repositories/organization-member-repository.js";
import type { IOrganizationMembershipEventRepository } from "../../../domain/repositories/organization-membership-event-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import type { IUnitOfWork } from "../../../domain/services/unit-of-work.js";
import type { UpdateMemberRoleInputDto } from "../../dto/organization-dto.js";

interface UpdateMemberRoleCommand extends UpdateMemberRoleInputDto {
  organizationId: string;
  actorUserId: string;
  // The membership row id, not a userId. Matches the URL shape
  // `/orgs/.../members/:memberId`.
  targetMemberId: string;
}

export class UpdateMemberRoleUseCase {
  constructor(
    private readonly memberships: IOrganizationMemberRepository,
    private readonly events: IOrganizationMembershipEventRepository,
    private readonly idGenerator: IIdGenerator,
    private readonly uow: IUnitOfWork,
  ) {}

  async execute(command: UpdateMemberRoleCommand): Promise<void> {
    const member = await this.memberships.findById(command.targetMemberId);
    if (!member || member.organizationId !== command.organizationId) {
      throw OrganizationMemberNotFoundError();
    }
    // Self-edit prohibition — an admin cannot demote/escalate their own
    // membership through this path. Stops privilege-escalation attempts
    // and preserves a consistent audit story (a separate user always
    // appears as actor for any role change).
    if (member.userId === command.actorUserId) {
      throw ForbiddenError("Cannot change your own role");
    }

    const oldRole = member.role;
    // The aggregate's `changeRole` rejects owner-touching transitions;
    // ownership transfer is reserved for `TransferOwnership`.
    member.changeRole(command.role);

    await this.uow.run(async () => {
      await this.memberships.save(member);
      const event = OrganizationMembershipEvent.create({
        id: this.idGenerator.newId(),
        organizationId: command.organizationId,
        eventType: "role_changed",
        actorUserId: command.actorUserId,
        targetUserId: member.userId,
        oldRole,
        newRole: member.role,
      });
      await this.events.append(event);
    });
  }
}
