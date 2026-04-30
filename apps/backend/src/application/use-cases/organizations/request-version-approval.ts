import type { VersionApprovalRequestDto } from "@plexus/shared-types";
import {
  OrganizationNotFoundError,
  VersionApprovalNotEnabledError,
  VersionApprovalRequestAlreadyPendingError,
} from "../../../domain/errors/domain-error.js";
import { VersionApprovalRequest } from "../../../domain/entities/version-approval-request.js";
import type { IOrganizationRepository } from "../../../domain/repositories/organization-repository.js";
import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { IVersionApprovalRequestRepository } from "../../../domain/repositories/version-approval-request-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import { loadPromptAndVersionInOrganization } from "../prompts/load-owned-prompt.js";
import { toVersionApprovalRequestDto } from "../../queries/version-approval-projections.js";

export interface RequestVersionApprovalCommand {
  organizationId: string;
  // The user issuing the request. Recorded as `requestedBy`; the
  // separation-of-duty rule on the aggregate prevents this user from
  // also voting `approve`.
  actorUserId: string;
  promptId: string;
  // Version label like `v3`. Resolved against the prompt root inside
  // the org scope so cross-org enumeration cannot create requests
  // against other tenants' versions.
  version: string;
}

// Issues a `VersionApprovalRequest` against a specific PromptVersion.
// Only valid when the org has an active `approvalPolicy` — otherwise
// the request would have no threshold to resolve against, and the
// caller should be using `PromoteVersion` directly.
//
// The `requiredApprovals` count is captured *here* and stored on the
// request aggregate so subsequent policy changes do not retroactively
// shrink/expand the threshold of an in-flight vote (see
// `SetApprovalPolicy` for the matching reasoning).
export class RequestVersionApprovalUseCase {
  constructor(
    private readonly organizations: IOrganizationRepository,
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
    private readonly approvals: IVersionApprovalRequestRepository,
    private readonly idGenerator: IIdGenerator,
  ) {}

  async execute(
    command: RequestVersionApprovalCommand,
  ): Promise<VersionApprovalRequestDto> {
    const org = await this.organizations.findById(command.organizationId);
    if (!org) {
      throw OrganizationNotFoundError();
    }
    if (org.approvalPolicy === null) {
      throw VersionApprovalNotEnabledError();
    }

    const { prompt, version } = await loadPromptAndVersionInOrganization(
      this.prompts,
      this.versions,
      command.promptId,
      command.version,
      command.organizationId,
    );

    // Pre-check is a UX shortcut; the unique partial index on the
    // repository is the integrity barrier that prevents two pending
    // requests against the same version from being persisted under a
    // race.
    const existing = await this.approvals.findActivePendingByVersion(
      command.organizationId,
      version.id,
    );
    if (existing) {
      throw VersionApprovalRequestAlreadyPendingError();
    }

    const request = VersionApprovalRequest.create({
      id: this.idGenerator.newId(),
      organizationId: command.organizationId,
      promptId: command.promptId,
      versionId: version.id,
      requestedBy: command.actorUserId,
      requiredApprovals: org.approvalPolicy.requiredApprovals,
    });
    await this.approvals.save(request);

    return toVersionApprovalRequestDto(request, {
      promptName: prompt.name,
      versionLabel: version.version,
    });
  }
}
