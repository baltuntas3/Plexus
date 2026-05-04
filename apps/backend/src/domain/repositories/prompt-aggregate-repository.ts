import type { Prompt } from "../entities/prompt.js";

// Write-side port for the Prompt aggregate root. Versions are a separate
// aggregate (see IPromptVersionRepository) so this repo never loads the
// version collection — rename/promote/generate pay a constant-size read
// regardless of version history depth.
export interface IPromptRepository {
  // Organization-scoped lookup. Collapses "missing" and "belongs to a
  // different org" into a single `null` so callers cannot accidentally
  // leak prompt existence via id enumeration across tenants.
  findInOrganization(id: string, organizationId: string): Promise<Prompt | null>;
  // Advances the aggregate's revision on success and throws
  // PromptAggregateStaleError on optimistic-concurrency failure.
  save(prompt: Prompt): Promise<void>;
}
