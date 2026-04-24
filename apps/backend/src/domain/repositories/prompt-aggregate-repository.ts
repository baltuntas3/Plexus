import type { Prompt } from "../entities/prompt.js";

export interface IPromptAggregateRepository {
  // Unscoped lookup. Reserved for internal/system paths that legitimately
  // operate across ownership boundaries (none today; kept as an explicit
  // seam). User-facing write use cases must use `findOwnedById`.
  findById(id: string): Promise<Prompt | null>;
  // Owner-scoped lookup. Collapses "missing" and "owned by someone else"
  // into a single `null` so callers cannot accidentally leak prompt
  // existence via id enumeration. All user-facing write use cases arrive
  // through here.
  findOwnedById(id: string, ownerId: string): Promise<Prompt | null>;
  // save advances the aggregate's revision on success and throws
  // PromptAggregateStaleError when the optimistic-concurrency check fails.
  save(prompt: Prompt): Promise<void>;
}
