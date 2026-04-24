import type { Prompt } from "../entities/prompt.js";

// Write-side port for the Prompt aggregate root. Versions are a separate
// aggregate (see IPromptVersionRepository) so this repo never loads the
// version collection — rename/promote/generate pay a constant-size read
// regardless of version history depth.
export interface IPromptRepository {
  // Unscoped lookup. Reserved for internal/system paths that legitimately
  // operate across ownership boundaries. User-facing write use cases must
  // use `findOwnedById`.
  findById(id: string): Promise<Prompt | null>;
  // Owner-scoped lookup. Collapses "missing" and "owned by someone else"
  // into a single `null` so callers cannot accidentally leak prompt
  // existence via id enumeration.
  findOwnedById(id: string, ownerId: string): Promise<Prompt | null>;
  // Advances the aggregate's revision on success and throws
  // PromptAggregateStaleError on optimistic-concurrency failure.
  save(prompt: Prompt): Promise<void>;
}
