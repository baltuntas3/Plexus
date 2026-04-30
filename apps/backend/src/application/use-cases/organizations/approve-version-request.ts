import type { VersionApprovalRequestDto } from "@plexus/shared-types";
import { PromptVersionNotFoundError } from "../../../domain/errors/domain-error.js";
import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { IVersionApprovalRequestRepository } from "../../../domain/repositories/version-approval-request-repository.js";
import type { IUnitOfWork } from "../../../domain/services/unit-of-work.js";
import { promoteVersionToProduction } from "../../services/promote-to-production.js";
import { toVersionApprovalRequestDto } from "../../queries/version-approval-projections.js";
import { loadPromptInOrganization } from "../prompts/load-owned-prompt.js";
import { loadApprovalRequestInOrganization } from "./load-approval-request.js";

export interface ApproveVersionRequestCommand {
  organizationId: string;
  actorUserId: string;
  requestId: string;
}

// Records an approve vote and — if the vote crossed the threshold —
// auto-promotes the underlying version to production *inside the same
// UoW*. Atomicity matters here: a partial outcome where the request is
// marked approved but the version status / prompt root pointer never
// updated would leave the org with an "approved but not in production"
// version that can never re-enter the workflow.
//
// All write paths funnel through `promoteVersionToProduction` so the
// "outgoing demoted to staging + incoming promoted + root pointer
// flipped" choreography is identical to the direct `PromoteVersion`
// path. Voting that does not cross the threshold simply persists the
// request and returns the updated DTO.
export class ApproveVersionRequestUseCase {
  constructor(
    private readonly approvals: IVersionApprovalRequestRepository,
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
    private readonly uow: IUnitOfWork,
  ) {}

  async execute(
    command: ApproveVersionRequestCommand,
  ): Promise<VersionApprovalRequestDto> {
    return this.uow.run(async () => {
      const request = await loadApprovalRequestInOrganization(
        this.approvals,
        command.requestId,
        command.organizationId,
      );

      // Load prompt + version up front: they are needed for the DTO
      // display context regardless of vote outcome, and again as the
      // promote-to-production target if the vote crosses the threshold.
      // Loading eagerly avoids a duplicate read in the auto-promote
      // branch and gives the projection one consistent view.
      const prompt = await loadPromptInOrganization(
        this.prompts,
        request.promptId,
        command.organizationId,
      );
      const version = await this.versions.findInOrganization(
        request.versionId,
        command.organizationId,
      );
      if (!version) {
        throw PromptVersionNotFoundError();
      }

      request.approve(command.actorUserId);
      await this.approvals.save(request);

      if (request.isApproved) {
        await promoteVersionToProduction(
          prompt,
          version,
          this.versions,
          this.prompts,
        );
      }

      return toVersionApprovalRequestDto(request, {
        promptName: prompt.name,
        versionLabel: version.version,
      });
    });
  }
}
