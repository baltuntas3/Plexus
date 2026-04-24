import type { PromptVersion } from "../entities/prompt-version.js";

// Write-side port for the PromptVersion aggregate. Separate from
// IPromptRepository because versions are their own consistency boundary:
// a rename or status change on one version must not require hydrating the
// prompt's entire version history.
//
// Ownership is enforced at the Prompt aggregate layer (callers load the
// Prompt owner-scoped first, then fetch the version), so lookups here are
// unscoped. A foreign version id can still be rejected by the use case
// after verifying promptId parity against the loaded Prompt.
export interface IPromptVersionRepository {
  findById(id: string): Promise<PromptVersion | null>;
  // Prompt-scoped label lookup. "v2 of prompt X" is the ubiquitous-language
  // operation, and the unique (promptId, version) index makes it a direct
  // hit rather than a list-and-filter.
  findByPromptAndLabel(
    promptId: string,
    label: string,
  ): Promise<PromptVersion | null>;
  // Advances the version's revision on success and throws
  // PromptVersionAggregateStaleError on optimistic-concurrency failure.
  save(version: PromptVersion): Promise<void>;
}
