import type { Prompt } from "../../../domain/entities/prompt.js";
import type { PromptVersion } from "../../../domain/entities/prompt-version.js";
import {
  PromptNotFoundError,
  PromptVersionNotFoundError,
} from "../../../domain/errors/domain-error.js";
import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";

// Loads a Prompt root scoped to the caller's organization, or throws. The
// repository collapses missing and cross-org into a single `null` so
// presentation uniformly surfaces a 404 — id enumeration cannot
// distinguish "does not exist" from "exists in another org". This is the
// scoping gate for write use cases.
export const loadPromptInOrganization = async (
  prompts: IPromptRepository,
  promptId: string,
  organizationId: string,
): Promise<Prompt> => {
  const prompt = await prompts.findInOrganization(promptId, organizationId);
  if (!prompt) {
    throw PromptNotFoundError();
  }
  return prompt;
};

// Common pairing: fetch the org-scoped Prompt root, then resolve a version
// by its prompt-scoped label. Keeps the join in one place so use cases
// that operate on "v2 of prompt X" do not have to compose it.
export const loadPromptAndVersionInOrganization = async (
  prompts: IPromptRepository,
  versions: IPromptVersionRepository,
  promptId: string,
  label: string,
  organizationId: string,
): Promise<{ prompt: Prompt; version: PromptVersion }> => {
  const prompt = await loadPromptInOrganization(prompts, promptId, organizationId);
  const version = await versions.findByPromptAndLabel(promptId, label);
  if (!version) {
    throw PromptVersionNotFoundError(label);
  }
  return { prompt, version };
};
