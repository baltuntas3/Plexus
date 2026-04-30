import { ValidationError } from "../../../domain/errors/domain-error.js";
import type { Prompt } from "../../../domain/entities/prompt.js";
import type { PromptVersion } from "../../../domain/entities/prompt-version.js";
import type { BraidGraph } from "../../../domain/value-objects/braid-graph.js";
import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import { loadPromptAndVersionInOrganization } from "./load-owned-prompt.js";

// Shared loader for the structural-edit primitives (rename node, add
// edge, …). Each primitive needs prompt + version + an existing braid
// graph; loading them once + asserting the graph exists is the only
// pre-condition the primitives share.
export const loadPromptVersionWithBraid = async (
  prompts: IPromptRepository,
  versions: IPromptVersionRepository,
  promptId: string,
  versionLabel: string,
  organizationId: string,
): Promise<{ prompt: Prompt; source: PromptVersion; graph: BraidGraph }> => {
  const { prompt, version: source } = await loadPromptAndVersionInOrganization(
    prompts,
    versions,
    promptId,
    versionLabel,
    organizationId,
  );
  if (!source.braidGraph) {
    throw ValidationError(
      "Cannot apply a structural edit to a version that has no BRAID graph",
    );
  }
  return { prompt, source, graph: source.braidGraph };
};
