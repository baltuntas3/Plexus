import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { IUnitOfWork } from "../../../domain/services/unit-of-work.js";
import type { PromoteVersionInputDto } from "../../dto/prompt-dto.js";
import type { PromptVersionSummary } from "../../queries/prompt-query-service.js";
import { versionToSummary } from "../../queries/prompt-projections.js";
import { loadPromptAndVersionInOrganization } from "./load-owned-prompt.js";

export interface PromoteVersionCommand extends PromoteVersionInputDto {
  promptId: string;
  version: string;
  organizationId: string;
  userId: string;
}

// Cross-aggregate orchestration for the "one production per prompt"
// invariant. Promotion touches up to three documents: the outgoing
// production version (demoted to staging), the incoming target (new
// status), and the Prompt root (productionVersionId pointer). All three
// writes live inside a single UoW so either every status lines up with
// the root's pointer or the entire attempt rolls back — there is no
// intermediate window where the status of two versions disagrees with
// the root.
export class PromoteVersionUseCase {
  constructor(
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
    private readonly uow: IUnitOfWork,
  ) {}

  async execute(command: PromoteVersionCommand): Promise<PromptVersionSummary> {
    return this.uow.run(async () => {
      const { prompt, version: target } = await loadPromptAndVersionInOrganization(
        this.prompts,
        this.versions,
        command.promptId,
        command.version,
        command.organizationId,
      );

      if (command.targetStatus === "production") {
        const currentProductionId = prompt.productionVersionId;
        if (currentProductionId && currentProductionId !== target.id) {
          const outgoing = await this.versions.findById(currentProductionId);
          if (outgoing) {
            outgoing.changeStatus("staging");
            await this.versions.save(outgoing);
          }
        }
        prompt.setProductionVersion(target.id);
      } else if (prompt.isProductionVersion(target.id)) {
        prompt.clearProductionVersion();
      }

      target.changeStatus(command.targetStatus);
      await this.versions.save(target);
      await this.prompts.save(prompt);

      return versionToSummary(target);
    });
  }
}
