import type { Prompt } from "../../../domain/entities/prompt.js";
import type { PromptVersion } from "../../../domain/entities/prompt-version.js";
import {
  PromptNotFoundError,
  PromptVersionNotFoundError,
} from "../../../domain/errors/domain-error.js";
import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";

// Loads an owned Prompt root or throws. The repository collapses missing
// and foreign-owned into a single `null` so presentation uniformly surfaces
// a 404 — id enumeration cannot distinguish "does not exist" from "exists
// but not yours". This is the ownership gate for write use cases;
// `assertOwnedBy` on the aggregate remains as defense-in-depth.
export const loadOwnedPrompt = async (
  prompts: IPromptRepository,
  promptId: string,
  ownerId: string,
): Promise<Prompt> => {
  const prompt = await prompts.findOwnedById(promptId, ownerId);
  if (!prompt) {
    throw PromptNotFoundError();
  }
  return prompt;
};

// Common pairing: fetch the owned Prompt root, then resolve a version by
// its prompt-scoped label. Keeps the ownership join in one place so use
// cases that operate on "v2 of prompt X" do not have to compose it.
export const loadOwnedPromptAndVersion = async (
  prompts: IPromptRepository,
  versions: IPromptVersionRepository,
  promptId: string,
  label: string,
  ownerId: string,
): Promise<{ prompt: Prompt; version: PromptVersion }> => {
  const prompt = await loadOwnedPrompt(prompts, promptId, ownerId);
  const version = await versions.findByPromptAndLabel(promptId, label);
  if (!version) {
    throw PromptVersionNotFoundError(label);
  }
  return { prompt, version };
};
