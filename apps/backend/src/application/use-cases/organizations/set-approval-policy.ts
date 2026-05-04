import type { OrganizationDto } from "@plexus/shared-types";
import { OrganizationNotFoundError } from "../../../domain/errors/domain-error.js";
import type { IOrganizationRepository } from "../../../domain/repositories/organization-repository.js";
import { toOrganizationDto } from "../../queries/organization-projections.js";

interface SetApprovalPolicyCommand {
  organizationId: string;
  // `null` clears the policy. Concrete `requiredApprovals` is bounded
  // 1..10 by the `Organization` aggregate; the use case forwards the
  // raw value without re-validating.
  requiredApprovals: number | null;
}

// Toggles or clears the org-level production gate. In-flight approval
// requests are intentionally **not** invalidated here — they keep the
// `requiredApprovals` they were created under. The motivation: lowering
// the policy mid-flight should not retroactively shrink an active
// request's threshold, and clearing it should not strand requests that
// were already on their way to a vote. New requests issued after the
// change naturally pick up the new policy.
//
// Returns the full updated `OrganizationDto` so callers can refresh
// their canonical org state from the response — frontend doesn't need a
// follow-up GET to discover whether the policy is now active.
export class SetApprovalPolicyUseCase {
  constructor(private readonly organizations: IOrganizationRepository) {}

  async execute(command: SetApprovalPolicyCommand): Promise<OrganizationDto> {
    const org = await this.organizations.findById(command.organizationId);
    if (!org) {
      throw OrganizationNotFoundError();
    }
    org.setApprovalPolicy(
      command.requiredApprovals === null
        ? null
        : { requiredApprovals: command.requiredApprovals },
    );
    await this.organizations.save(org);
    return toOrganizationDto(org);
  }
}
