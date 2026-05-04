import type { VersionApprovalRequestDto } from "@plexus/shared-types";
import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { IVersionApprovalRequestRepository } from "../../../domain/repositories/version-approval-request-repository.js";
import { resolveApprovalDisplayContextMap } from "../../queries/resolve-approval-display-context.js";
import { toVersionApprovalRequestDto } from "../../queries/version-approval-projections.js";

interface ListPendingApprovalRequestsCommand {
  organizationId: string;
}

// Org-scoped inbox of pending approval requests. UI surfaces this on
// the approver dashboard; resolved (approved/rejected/cancelled)
// requests are filtered out at the repository so the response shape
// stays focused on actionable items.
//
// Display context (prompt name + version label) is batch-resolved so
// the response is N + M reads, not N × 2: one lookup per distinct
// prompt and one per distinct version regardless of how many requests
// share them.
export class ListPendingApprovalRequestsUseCase {
  constructor(
    private readonly approvals: IVersionApprovalRequestRepository,
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
  ) {}

  async execute(
    command: ListPendingApprovalRequestsCommand,
  ): Promise<VersionApprovalRequestDto[]> {
    const requests = await this.approvals.listPendingByOrganization(
      command.organizationId,
    );
    const contextMap = await resolveApprovalDisplayContextMap(
      requests,
      this.prompts,
      this.versions,
    );
    return requests.map((r) =>
      toVersionApprovalRequestDto(r, contextMap.get(r.id)!),
    );
  }
}
