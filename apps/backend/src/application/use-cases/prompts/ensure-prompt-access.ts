import type { IPromptRepository } from "../../../domain/repositories/prompt-repository.js";
import type { Prompt } from "../../../domain/entities/prompt.js";
import { ForbiddenError, NotFoundError } from "../../../domain/errors/domain-error.js";

export const ensurePromptAccess = async (
  prompts: IPromptRepository,
  promptId: string,
  ownerId: string,
): Promise<Prompt> => {
  const prompt = await prompts.findById(promptId);
  if (!prompt) {
    throw NotFoundError("Prompt not found");
  }
  if (prompt.ownerId !== ownerId) {
    throw ForbiddenError("You don't own this prompt");
  }
  return prompt;
};
