import {
  OrganizationNotFoundError,
  VersionApprovalRequiredError,
} from "../../../domain/errors/domain-error.js";
import type { IOrganizationRepository } from "../../../domain/repositories/organization-repository.js";
import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { IUnitOfWork } from "../../../domain/services/unit-of-work.js";
import type { PromoteVersionInputDto } from "../../dto/prompt-dto.js";
import type { PromptVersionSummary } from "../../queries/prompt-query-service.js";
import { versionToSummary } from "../../queries/prompt-projections.js";
import { promoteVersionToProduction } from "../../services/promote-to-production.js";
import { loadPromptAndVersionInOrganization } from "./load-owned-prompt.js";

interface PromoteVersionCommand extends PromoteVersionInputDto {
  promptId: string;
  version: string;
  organizationId: string;
}

// Cross-aggregate orchestration for the "one production per prompt"
// invariant. Promotion touches up to three documents (outgoing
// production demoted to staging, incoming target status, prompt root
// pointer); the shared `promoteVersionToProduction` helper executes
// those writes inside this use case's UoW so the same critical-section
// composes for both the direct path here and the auto-promotion path
// in `ApproveVersionRequest`.
//
// Approval-policy gate: when the org has an active `approvalPolicy`,
// `→ production` cannot go through this path — callers must route via
// `RequestVersionApproval` so the threshold-based workflow records the
// promotion provenance. Other transitions (draft→development,
// development→staging, etc.) remain direct.
export class PromoteVersionUseCase {
  constructor(
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
    private readonly organizations: IOrganizationRepository,
    private readonly uow: IUnitOfWork,
  ) {}

  async execute(command: PromoteVersionCommand): Promise<PromptVersionSummary> {
    return this.uow.run(async () => {
      // Approval-policy check moves inside the UoW so a policy added between
      // the read and the write cannot let a `→ production` slip past the
      // approval workflow. The org snapshot the policy gate consults is the
      // same one the surrounding transaction sees.
      if (command.targetStatus === "production") {
        const org = await this.organizations.findById(command.organizationId);
        if (!org) {
          throw OrganizationNotFoundError();
        }
        if (org.approvalPolicy !== null) {
          throw VersionApprovalRequiredError();
        }
      }

      const { prompt, version: target } = await loadPromptAndVersionInOrganization(
        this.prompts,
        this.versions,
        command.promptId,
        command.version,
        command.organizationId,
      );

      if (command.targetStatus === "production") {
        await promoteVersionToProduction(prompt, target, this.versions, this.prompts);
      } else {
        if (prompt.isProductionVersion(target.id)) {
          prompt.clearProductionVersion();
        }
        target.changeStatus(command.targetStatus);
        await this.versions.save(target);
        await this.prompts.save(prompt);
      }

      return versionToSummary(target);
    });
  }
}
