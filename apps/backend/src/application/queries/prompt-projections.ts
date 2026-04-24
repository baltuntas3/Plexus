import type { Prompt } from "../../domain/entities/prompt.js";
import type { PromptVersion } from "../../domain/entities/prompt-version.js";
import type {
  PromptSummary,
  PromptVersionSummary,
} from "./prompt-query-service.js";

// Entity → read-projection adapter. Lets write use cases hand a projection
// back to the presentation layer so it never sees a live aggregate.
//
// `productionVersion` in the summary is a label ("v2") whereas the Prompt
// root tracks `productionVersionId`. The production label is only needed
// when the caller has the corresponding PromptVersion in hand; callers
// without it (e.g. a freshly created prompt where no version is yet
// production) pass `null`.

export const promptToSummary = (
  prompt: Prompt,
  productionVersionLabel: string | null = null,
): PromptSummary => ({
  id: prompt.id,
  name: prompt.name,
  description: prompt.description,
  taskType: prompt.taskType,
  ownerId: prompt.ownerId,
  productionVersion: productionVersionLabel,
  createdAt: prompt.createdAt,
  updatedAt: prompt.updatedAt,
});

export const versionToSummary = (version: PromptVersion): PromptVersionSummary => ({
  id: version.id,
  promptId: version.promptId,
  version: version.version,
  name: version.name,
  parentVersionId: version.parentVersionId,
  sourcePrompt: version.sourcePrompt,
  braidGraph: version.braidGraph?.mermaidCode ?? null,
  braidAuthorship: version.braidAuthorship?.toSnapshot() ?? null,
  generatorModel: version.generatorModel,
  executablePrompt: version.executablePrompt,
  status: version.status,
  createdAt: version.createdAt,
  updatedAt: version.updatedAt,
});
