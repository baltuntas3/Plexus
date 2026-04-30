import type { VersionApprovalRequestDto } from "@plexus/shared-types";
import { ForbiddenError } from "../../../domain/errors/domain-error.js";
import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { IVersionApprovalRequestRepository } from "../../../domain/repositories/version-approval-request-repository.js";
import { resolveApprovalDisplayContext } from "../../queries/resolve-approval-display-context.js";
import { toVersionApprovalRequestDto } from "../../queries/version-approval-projections.js";
import { loadApprovalRequestInOrganization } from "./load-approval-request.js";

export interface CancelVersionRequestCommand {
  organizationId: string;
  actorUserId: string;
  requestId: string;
  // Pre-resolved at the controller from the role→permission map. Admins
  // can cancel anyone's request (`approval:cancel_any`); the requester
  // can always cancel their own (`approval:cancel_own`). Passing the
  // pre-resolved capabilities here keeps the use case independent of
  // the permission enforcement layer.
  canCancelAny: boolean;
}

// Cancellation is non-vote and does not record an approver — the audit
// trail of who cancelled lives on the membership/version event log
// maintained by the controller surface, not on this aggregate row.
export class CancelVersionRequestUseCase {
  constructor(
    private readonly approvals: IVersionApprovalRequestRepository,
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
  ) {}

  async execute(
    command: CancelVersionRequestCommand,
  ): Promise<VersionApprovalRequestDto> {
    const request = await loadApprovalRequestInOrganization(
      this.approvals,
      command.requestId,
      command.organizationId,
    );
    if (!command.canCancelAny && request.requestedBy !== command.actorUserId) {
      throw ForbiddenError(
        "Only the requester or an admin can cancel an approval request",
      );
    }
    request.cancel();
    await this.approvals.save(request);
    const context = await resolveApprovalDisplayContext(
      request,
      this.prompts,
      this.versions,
    );
    return toVersionApprovalRequestDto(request, context);
  }
}
