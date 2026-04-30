import type { Prompt } from "../../domain/entities/prompt.js";
import type { PromptVersion } from "../../domain/entities/prompt-version.js";
import type { IPromptRepository } from "../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../domain/repositories/prompt-version-repository.js";

// Single source of truth for the "make `target` the prompt's production
// version" cross-aggregate write. Used by `PromoteVersion` (direct
// promotion when no approval policy is active) and by
// `ApproveVersionRequest` (auto-promotion when the approval threshold is
// reached). The caller owns the surrounding UoW boundary so the same
// helper composes inside both paths without nesting transactions.
//
// Touches up to three aggregates: the outgoing production version
// (demoted to staging), the incoming target (status → production), and
// the prompt root (productionVersionId pointer). All three writes flow
// through the caller's UoW so either every status lines up with the
// root pointer or the entire attempt rolls back.
export const promoteVersionToProduction = async (
  prompt: Prompt,
  target: PromptVersion,
  versions: IPromptVersionRepository,
  prompts: IPromptRepository,
): Promise<void> => {
  const currentProductionId = prompt.productionVersionId;
  if (currentProductionId && currentProductionId !== target.id) {
    // Org-scoped lookup — `prompt.organizationId` is the same tenant the
    // outgoing version must live in by construction (one prompt root, one
    // org). Passing it explicitly keeps the version repo's defense-in-depth
    // contract intact.
    const outgoing = await versions.findInOrganization(
      currentProductionId,
      prompt.organizationId,
    );
    if (outgoing) {
      outgoing.changeStatus("staging");
      await versions.save(outgoing);
    }
  }
  prompt.setProductionVersion(target.id);
  target.changeStatus("production");
  await versions.save(target);
  await prompts.save(prompt);
};
