import type { Prompt } from "../../domain/entities/prompt.js";
import type { PromptVersion } from "../../domain/entities/prompt-version.js";
import type {
  PromptSummary,
  PromptVersionSummary,
} from "./prompt-query-service.js";

// Entity → read-projection adapter. Lets write use cases hand a projection
// back to the presentation layer so it never sees a live aggregate —
// preserves the CQRS split even though the command just mutated and has
// the entity in hand. Without this, presentation would either import
// domain entities (leak) or pay a fresh read round-trip just to get the
// shape it already knows the answer to.
//
// Callers that ran a mutation and then called `repo.save(...)` already
// have the post-save state on their entity, so these projections are
// correct up to the just-written revision.

export const promptToSummary = (prompt: Prompt): PromptSummary => ({
  id: prompt.id,
  name: prompt.name,
  description: prompt.description,
  taskType: prompt.taskType,
  ownerId: prompt.ownerId,
  productionVersion: prompt.productionVersion,
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
