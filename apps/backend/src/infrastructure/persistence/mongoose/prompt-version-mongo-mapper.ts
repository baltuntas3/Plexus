import type { Types } from "mongoose";
import type {
  PromptRepresentationPrimitives,
  PromptVersionPrimitives,
} from "../../../domain/entities/prompt-version.js";
import type { PromptVersionSummary } from "../../../application/queries/prompt-query-service.js";

// Shared Mongo ↔ Domain conversions for PromptVersion. Centralising these
// keeps the aggregate write-repo, the read-side query service, and any
// future read projection in lock-step when the schema changes.

export interface PromptVersionDocShape {
  _id: Types.ObjectId;
  promptId: Types.ObjectId;
  version: string;
  name: string | null;
  parentVersionId: Types.ObjectId | null;
  sourcePrompt: string;
  representation: {
    kind: "classical" | "braid";
    graph: string | null;
    generatorModel: string | null;
  };
  status: PromptVersionPrimitives["status"];
  createdAt: Date;
  updatedAt: Date;
}

export const toRepresentation = (
  doc: PromptVersionDocShape["representation"],
): PromptRepresentationPrimitives => {
  if (doc.kind === "braid" && doc.graph && doc.generatorModel) {
    return { kind: "braid", graph: doc.graph, generatorModel: doc.generatorModel };
  }
  return { kind: "classical" };
};

export const toVersionPrimitives = (
  doc: PromptVersionDocShape,
): PromptVersionPrimitives => ({
  id: String(doc._id),
  promptId: String(doc.promptId),
  version: doc.version,
  name: doc.name ?? null,
  parentVersionId: doc.parentVersionId ? String(doc.parentVersionId) : null,
  sourcePrompt: doc.sourcePrompt,
  representation: toRepresentation(doc.representation),
  status: doc.status,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

// Read projection. `executablePrompt` is pre-resolved (braid graph when
// present, otherwise the classical source) so benchmark callers can build
// evaluation prompts without caring about representation discrimination.
export const toVersionSummary = (
  doc: PromptVersionDocShape,
): PromptVersionSummary => {
  const representation = toRepresentation(doc.representation);
  const braidGraph = representation.kind === "braid" ? representation.graph : null;
  return {
    id: String(doc._id),
    promptId: String(doc.promptId),
    version: doc.version,
    name: doc.name ?? null,
    parentVersionId: doc.parentVersionId ? String(doc.parentVersionId) : null,
    sourcePrompt: doc.sourcePrompt,
    braidGraph,
    generatorModel:
      representation.kind === "braid" ? representation.generatorModel : null,
    executablePrompt: braidGraph ?? doc.sourcePrompt,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

export const toVersionDocSet = (
  version: PromptVersionPrimitives,
): Record<string, unknown> => ({
  promptId: version.promptId,
  version: version.version,
  name: version.name,
  parentVersionId: version.parentVersionId,
  sourcePrompt: version.sourcePrompt,
  representation:
    version.representation.kind === "braid"
      ? {
          kind: "braid",
          graph: version.representation.graph,
          generatorModel: version.representation.generatorModel,
        }
      : { kind: "classical", graph: null, generatorModel: null },
  status: version.status,
  createdAt: version.createdAt,
  updatedAt: version.updatedAt,
});
