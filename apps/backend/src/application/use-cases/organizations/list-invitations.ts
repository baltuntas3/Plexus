import type { OrganizationInvitationDto } from "@plexus/shared-types";
import type { IOrganizationInvitationRepository } from "../../../domain/repositories/organization-invitation-repository.js";
import { toInvitationDto } from "../../queries/organization-projections.js";

export interface ListInvitationsCommand {
  organizationId: string;
}

export class ListInvitationsUseCase {
  constructor(
    private readonly invitations: IOrganizationInvitationRepository,
  ) {}

  async execute(
    command: ListInvitationsCommand,
  ): Promise<OrganizationInvitationDto[]> {
    const rows = await this.invitations.listByOrganization(
      command.organizationId,
    );
    return rows.map(toInvitationDto);
  }
}
