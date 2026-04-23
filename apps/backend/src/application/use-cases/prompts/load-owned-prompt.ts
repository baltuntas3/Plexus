import type { Prompt } from "../../../domain/entities/prompt.js";
import { NotFoundError } from "../../../domain/errors/domain-error.js";
import type { IPromptAggregateRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";

// Loads an owned Prompt aggregate or throws. Encodes the "find → 404 → assert
// ownership" orchestration that every Prompt write use case needs, so the
// ForbiddenError vs. NotFoundError distinction stays consistent and no caller
// can accidentally skip the ownership check.
export const loadOwnedPrompt = async (
  prompts: IPromptAggregateRepository,
  promptId: string,
  ownerId: string,
): Promise<Prompt> => {
  const prompt = await prompts.findById(promptId);
  if (!prompt) {
    throw NotFoundError("Prompt not found");
  }
  prompt.assertOwnedBy(ownerId);
  return prompt;
};
