import type { VersionApprovalRequestDto } from "@plexus/shared-types";
import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { IVersionApprovalRequestRepository } from "../../../domain/repositories/version-approval-request-repository.js";
import { resolveApprovalDisplayContext } from "../../queries/resolve-approval-display-context.js";
import { toVersionApprovalRequestDto } from "../../queries/version-approval-projections.js";
import { loadApprovalRequestInOrganization } from "./load-approval-request.js";

export interface RejectVersionRequestCommand {
  organizationId: string;
  actorUserId: string;
  requestId: string;
}

// A single rejection resolves the request as `rejected` (see the
// aggregate's reject() docstring for the conservative-gate rationale).
// No side-effects on the underlying version: the requester re-issues a
// new approval request after addressing the objection.
export class RejectVersionRequestUseCase {
  constructor(
    private readonly approvals: IVersionApprovalRequestRepository,
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
  ) {}

  async execute(
    command: RejectVersionRequestCommand,
  ): Promise<VersionApprovalRequestDto> {
    const request = await loadApprovalRequestInOrganization(
      this.approvals,
      command.requestId,
      command.organizationId,
    );
    request.reject(command.actorUserId);
    await this.approvals.save(request);
    const context = await resolveApprovalDisplayContext(
      request,
      this.prompts,
      this.versions,
    );
    return toVersionApprovalRequestDto(request, context);
  }
}
