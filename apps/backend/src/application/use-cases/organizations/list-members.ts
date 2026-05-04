import type { OrganizationMemberDto } from "@plexus/shared-types";
import type { IOrganizationMemberRepository } from "../../../domain/repositories/organization-member-repository.js";
import { toMemberDto } from "../../queries/organization-projections.js";

interface ListMembersCommand {
  organizationId: string;
}

export class ListMembersUseCase {
  constructor(private readonly memberships: IOrganizationMemberRepository) {}

  async execute(command: ListMembersCommand): Promise<OrganizationMemberDto[]> {
    const members = await this.memberships.listByOrganization(
      command.organizationId,
    );
    return members.map(toMemberDto);
  }
}
