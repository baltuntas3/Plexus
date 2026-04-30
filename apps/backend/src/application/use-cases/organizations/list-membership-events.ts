import type { OrganizationMembershipEventDto } from "@plexus/shared-types";
import type { IOrganizationMembershipEventRepository } from "../../../domain/repositories/organization-membership-event-repository.js";
import { toMembershipEventDto } from "../../queries/organization-projections.js";

export interface ListMembershipEventsCommand {
  organizationId: string;
}

export class ListMembershipEventsUseCase {
  constructor(
    private readonly events: IOrganizationMembershipEventRepository,
  ) {}

  async execute(
    command: ListMembershipEventsCommand,
  ): Promise<OrganizationMembershipEventDto[]> {
    const rows = await this.events.listByOrganization(command.organizationId);
    return rows.map(toMembershipEventDto);
  }
}
