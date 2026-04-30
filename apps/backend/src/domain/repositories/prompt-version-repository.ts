import type { PromptVersion } from "../entities/prompt-version.js";

// Write-side port for the PromptVersion aggregate. Separate from
// IPromptRepository because versions are their own consistency boundary:
// a rename or status change on one version must not require hydrating the
// prompt's entire version history.
//
// All read methods are org-scoped — the version document carries its
// owning organisation id (denormalised from the parent Prompt) so the
// repository can filter on it directly. This is the defense-in-depth
// layer: even if a use case forgets to load the Prompt root first,
// supplying a foreign organisation id makes the version effectively
// invisible. Cross-tenant id enumeration cannot distinguish "missing"
// from "exists in another org".
export interface IPromptVersionRepository {
  findInOrganization(
    id: string,
    organizationId: string,
  ): Promise<PromptVersion | null>;
  // Prompt-scoped label lookup. "v2 of prompt X" is the ubiquitous-language
  // operation, and the unique (promptId, version) index makes it a direct
  // hit rather than a list-and-filter.
  findByPromptAndLabelInOrganization(
    promptId: string,
    label: string,
    organizationId: string,
  ): Promise<PromptVersion | null>;
  // Advances the version's revision on success and throws
  // PromptVersionAggregateStaleError on optimistic-concurrency failure.
  save(version: PromptVersion): Promise<void>;
}
