import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { PromoteVersionInputDto } from "../../dto/prompt-dto.js";
import type { PromptVersionSummary } from "../../queries/prompt-query-service.js";
import { versionToSummary } from "../../queries/prompt-projections.js";
import { loadOwnedPromptAndVersion } from "./load-owned-prompt.js";

export interface PromoteVersionCommand extends PromoteVersionInputDto {
  promptId: string;
  version: string;
  ownerId: string;
}

// Cross-aggregate orchestration for the "one production per prompt"
// invariant. With versions as their own aggregate, promotion touches up to
// three documents: the outgoing production version (demoted to staging),
// the incoming target (new status), and the Prompt root (productionVersionId
// pointer). Each save is gated by its own revision so concurrent promotes
// from different sessions are caught. A small inconsistency window exists
// between the three writes; retrying repairs it, and the Prompt root's
// productionVersionId is the source of truth for "which version is live"
// so a transiently wrong status on a version is self-correcting.
export class PromoteVersionUseCase {
  constructor(
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
  ) {}

  async execute(command: PromoteVersionCommand): Promise<PromptVersionSummary> {
    const { prompt, version: target } = await loadOwnedPromptAndVersion(
      this.prompts,
      this.versions,
      command.promptId,
      command.version,
      command.ownerId,
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
  }
}
