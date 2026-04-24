import type { Prompt } from "../../../domain/entities/prompt.js";
import { PromptNotFoundError } from "../../../domain/errors/domain-error.js";
import type { IPromptAggregateRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";

// Loads an owned Prompt aggregate or throws. The repository collapses
// missing and foreign-owned into a single `null` so presentation uniformly
// surfaces a 404 — id enumeration cannot discriminate between "does not
// exist" and "exists but not yours". This is the only load path for write
// use cases; `assertOwnedBy` on the aggregate remains as defense-in-depth
// for code paths that do not go through a repository.
export const loadOwnedPrompt = async (
  prompts: IPromptAggregateRepository,
  promptId: string,
  ownerId: string,
): Promise<Prompt> => {
  const prompt = await prompts.findOwnedById(promptId, ownerId);
  if (!prompt) {
    throw PromptNotFoundError();
  }
  return prompt;
};
